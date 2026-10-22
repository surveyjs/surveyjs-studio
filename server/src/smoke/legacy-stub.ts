import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { RestError, type TableClient } from "@azure/data-tables";
import sql from "mssql";
import type { LegacyConfig } from "../config.js";
import { localBlobServiceClient, localTableClient } from "../legacy/local-clients.js";

/**
 * Test support: an in-process stand-in for the `api.surveyjs.io` reads of `pnpm smoke:legacy`,
 * backed by the local replica. It reads the stores directly, the way legacy-data-layout section 7
 * says the old API does (SQL `Surveys` and `OrganizationUsers`, blobs `surveyjson` and
 * `surveyjsonhistory`, tables `post{postId}` and `SurveyCompletion{surveyId}`), never through the
 * app's provider. Like the old API it echoes a wrong access key in its error text, so tests can
 * prove the smoke test never prints a legacy answer.
 */

export interface LegacyStubOptions {
  /** The replica's connection strings; the clients refuse any endpoint that is not local. */
  readonly config: LegacyConfig;
  /** Access key → user id (the old API reads `Users.accesskey`; the stub is told). */
  readonly accessKeys: Readonly<Record<string, string>>;
  /** `name`: `getActive` answers another name than stored (a corrupted write). */
  readonly corrupt?: { readonly name?: boolean };
}

export interface LegacyStub {
  readonly url: string;
  close(): Promise<void>;
}

type Row = Record<string, unknown>;

/** A table value without its Edm wrapper (`{ value, type: "Guid" }`). */
const plain = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;
const lower = (value: unknown): unknown => {
  const v = plain(value);
  return typeof v === "string" ? v.toLowerCase() : v;
};
const dashless = (id: string): string => id.replaceAll("-", "").toLowerCase();
const flag = (value: unknown): boolean => value === 1 || value === true || value === "1";

/** A stub answer: a JSON value, or raw text when `contentType` is given. */
class Answer {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly contentType?: string,
  ) {}
}

const TEXT = "text/plain; charset=utf-8";
const JSON_TEXT = "application/json; charset=utf-8";
const badRequest = (text: string): Answer => new Answer(400, text, TEXT);

export async function startLegacyStub(options: LegacyStubOptions): Promise<LegacyStub> {
  const { config, accessKeys, corrupt = {} } = options;
  const pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
  const blobs = localBlobServiceClient(
    config.surveysStorageConnectionString,
    "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  );
  const table = (name: string): TableClient =>
    localTableClient(
      config.resultsStorageConnectionString,
      name,
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    );

  async function surveyWhere(column: "id" | "resultid", id: string): Promise<Row | undefined> {
    const result = await pool
      .request()
      .input("p", sql.UniqueIdentifier, id)
      .query<Row>(`SELECT * FROM Surveys WHERE ${column} = @p`);
    return result.recordset[0];
  }

  async function isMember(userId: string, organizationId: string): Promise<boolean> {
    const result = await pool
      .request()
      .input("u", sql.UniqueIdentifier, userId)
      .input("o", sql.UniqueIdentifier, organizationId)
      .query("SELECT 1 AS one FROM OrganizationUsers WHERE userid = @u AND organizationid = @o");
    return result.recordset.length > 0;
  }

  /** `GetAutorizedSurvey`: the owner, or a member of the owning project. */
  async function authorized(userId: string, survey: Row | undefined): Promise<boolean> {
    if (survey === undefined) return false;
    const owner = String(lower(survey.userid));
    return owner === userId || (await isMember(userId, owner));
  }

  /** The `Survey` model as Newtonsoft writes it. */
  function legacySurvey(row: Row): Row {
    const name = typeof row.name === "string" && corrupt.name ? `${row.name} (changed)` : row.name;
    return {
      Id: lower(row.id),
      Name: name,
      IsArchived: flag(row.isarchived),
      UserId: lower(row.userid),
      CreatorId: lower(row.creatorid),
      PostId: lower(row.postid),
      ResultId: lower(row.resultid),
      PublishId: lower(row.publishid),
      IsPublished: row.ispublished === null ? null : flag(row.ispublished),
      UseCookies: flag(row.usecookies),
      UpdatedOn: row.timestamp,
      CreatedAt: row.createdat,
      AllowAccessResult: flag(row.allowaccessresult),
      StoreIPAddress: flag(row.storeipaddress),
      Theme: row.theme,
      Json: null,
    };
  }

  async function blobText(container: string, name: string): Promise<string | null> {
    try {
      const buffer = await blobs
        .getContainerClient(container)
        .getBlobClient(name)
        .downloadToBuffer();
      return buffer.toString("utf8");
    } catch (error) {
      if (error instanceof Error && (error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /** The rows of `post{postId}` as the JSON readers return them (`GetRowData`). */
  async function resultRows(survey: Row, fullAccess: boolean): Promise<Row[]> {
    const rows: Row[] = [];
    try {
      for await (const entity of table(`post${dashless(String(survey.postid))}`).listEntities()) {
        const data = JSON.parse(String(entity.result)) as Row;
        rows.push({
          ...data,
          HappendAt: entity.happendat,
          ...(entity.clientid !== undefined && { ClientId: entity.clientid }),
          InstanceId: fullAccess ? lower(entity.id) : null,
        });
      }
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) return [];
      throw error;
    }
    return rows;
  }

  async function completion(survey: Row, clientId: string): Promise<string> {
    try {
      const entity = await table(`SurveyCompletion${dashless(String(survey.id))}`).getEntity(
        "*",
        clientId,
      );
      return entity.ispartialcompleted === true ? "partial" : "completed";
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) return "no";
      throw error;
    }
  }

  /** The user the key names; null answers 401 with the key in the text, as the old API does. */
  function userOf(query: URLSearchParams): string | null {
    const key = query.get("accessKey") ?? "";
    return accessKeys[key]?.toLowerCase() ?? null;
  }

  async function answer(path: string, query: URLSearchParams): Promise<Answer> {
    // `/{public|private}[/v1]/{controller}/{action}[/{id}]`, matched without case as ASP.NET does.
    const parts = path.split("/").filter((p) => p !== "" && p.toLowerCase() !== "v1");
    const route = parts.slice(0, 3).join("/").toLowerCase();
    const param = (name: string): string => query.get(name) ?? "";
    const routeId = (): string => (parts[3] ? decodeURIComponent(parts[3]) : param("id"));

    if (route === "public/survey/getsurvey") {
      const text = await blobText("surveyjson", param("surveyId").toLowerCase());
      return text ? new Answer(200, text, JSON_TEXT) : badRequest("Check parameter values.");
    }
    if (route === "public/survey/getresult") {
      const survey = await surveyWhere("resultid", param("resultId"));
      if (survey === undefined || param("name") === "") {
        return badRequest("Check parameter values.");
      }
      const rows = await resultRows(survey, true);
      const counts: Record<string, number> = {};
      let answers = 0;
      for (const row of rows) {
        const value = row[param("name")];
        if (value === undefined || value === null) continue;
        answers += 1;
        const key = String(value);
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return new Answer(200, {
        AnswersCount: answers,
        QuestionResult: counts,
        ResultCount: rows.length,
      });
    }
    if (route === "public/survey/iscompleted") {
      const survey = await surveyWhere("resultid", param("resultId"));
      const state = survey === undefined ? "no" : await completion(survey, param("clientId"));
      return new Answer(200, state);
    }
    if (route === "private/surveys/getsurveypublicresults") {
      const survey = await surveyWhere("id", routeId());
      if (survey === undefined || !flag(survey.allowaccessresult)) {
        return badRequest("You are not authorized to get results of the survey");
      }
      const rows = await resultRows(survey, false);
      return new Answer(200, { Data: rows, ResultCount: rows.length });
    }

    // The private calls below need the access key.
    const userId = userOf(query);
    if (userId === null) {
      return new Answer(401, `The accessKey '${param("accessKey")}' is incorrect.`, TEXT);
    }
    if (route === "private/surveys/getactive") {
      const ownerId = param("ownerId");
      const owner = ownerId !== "" && (await isMember(userId, ownerId)) ? ownerId : userId;
      const result = await pool
        .request()
        .input("p", sql.UniqueIdentifier, owner)
        .query<Row>("SELECT * FROM Surveys WHERE userid = @p");
      const active = result.recordset.filter((row) => !flag(row.isarchived));
      return new Answer(200, active.map(legacySurvey));
    }
    if (route === "private/surveys/gethistorypoint") {
      const surveyId = routeId().toLowerCase();
      if (!(await authorized(userId, await surveyWhere("id", surveyId)))) {
        return badRequest("You are not authorized to read the history of the survey");
      }
      const text = await blobText(
        "surveyjsonhistory",
        `${surveyId}/${param("pointId").toLowerCase()}`,
      );
      return text ? new Answer(200, text, JSON_TEXT) : badRequest("Check parameter values.");
    }
    if (route === "private/surveys/getsurveyresults") {
      const survey = await surveyWhere("id", routeId());
      if (survey === undefined || !(await authorized(userId, survey))) {
        return badRequest("You are not authorized to get results of the survey");
      }
      const rows = await resultRows(survey, true);
      return new Answer(200, { Data: rows, ResultCount: rows.length });
    }
    return new Answer(404, "Not found", TEXT);
  }

  function send(response: ServerResponse, reply: Answer): void {
    const raw = reply.contentType !== undefined;
    const body = raw ? String(reply.body) : JSON.stringify(reply.body);
    response.writeHead(reply.status, { "content-type": reply.contentType ?? JSON_TEXT });
    response.end(body);
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://stub.invalid");
    if (request.method !== "GET") {
      send(response, new Answer(405, "Method not allowed", TEXT));
      return;
    }
    answer(url.pathname, url.searchParams).then(
      (reply) => send(response, reply),
      () => send(response, new Answer(500, "Stub failure", TEXT)),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.close();
    },
  };
}
