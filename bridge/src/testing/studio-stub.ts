// A fake Studio for the action tests: the public operations the bridge calls, answered from maps
// the test fills, with every request recorded. `override` answers a request differently (a status
// the test wants) before the fake's own routing.
import type { ServerResponse } from "node:http";
import { startStub, type RecordedRequest, type Stub } from "./http.js";

export type RespondentState = "none" | "partial" | "completed";

export interface StoredDefinition {
  definition: unknown;
  /** The strong ETag Studio sends; `undefined` sends none. */
  etag: string | undefined;
}

/** One survey's completed responses as `getQuestionSummary` counts them, by result ID. */
export interface StoredSummary {
  responseCount: number;
  firstSubmittedAt: string | null;
  lastSubmittedAt: string | null;
  /** By question name: `answered`, and `values` as raw JSON text (so a test can send `1.0`). */
  questions: Record<string, { answered: number; values: string }>;
}

export interface StoredFile {
  contentType: string;
  body: Buffer;
}

export interface StoredPublicResults {
  /** Raw JSON texts of the items (`{ submittedAt, data }`), oldest first. */
  items: string[];
  privateQuestions?: string[];
}

export interface FakeStudio extends Stub {
  /** Definitions by survey ID. */
  definitions: Map<string, StoredDefinition>;
  /** Respondent states by `surveyId/clientId` (the client ID decoded). */
  states: Map<string, RespondentState>;
  /** Result ID → survey ID; post ID → survey ID. */
  resultIds: Map<string, string>;
  postIds: Map<string, string>;
  /** Answers a request itself when it returns true. */
  override: ((request: RecordedRequest, res: ServerResponse) => boolean) | undefined;
  /** `getQuestionSummary` by result ID. */
  summaries: Map<string, StoredSummary>;
  /** `downloadFile` by file ID. */
  files: Map<string, StoredFile>;
  /** `getLegacyFile` by `kind/name`. */
  legacyFiles: Map<string, StoredFile>;
  /** `getPublicResults` by survey ID. */
  publicResults: Map<string, StoredPublicResults>;
  /** Items per page of `getPublicResults`, whatever `limit` asks (`undefined`: `limit`). */
  pageSize: number | undefined;
  /** The file Studio answers an upload with. */
  storedFile: { id: string; url: string; name: string; contentType: string; size: number };
  /** Clears the maps, the recorded requests and the override. */
  reset(): void;
}

const API = "/api/v1";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, file: StoredFile, name: string): void {
  res
    .writeHead(200, {
      "content-type": file.contentType,
      "content-length": String(file.body.length),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cross-origin-resource-policy": "cross-origin",
    })
    .end(file.body);
}

/** Studio's `getPublicResults`: paged by an index cursor, `from` and `till` exclusive. */
function publicResults(fake: FakeStudio, res: ServerResponse, surveyId: string, url: URL): void {
  const stored = fake.publicResults.get(surveyId);
  if (stored === undefined) return problem(res, 404);
  const from = url.searchParams.get("from");
  const till = url.searchParams.get("till");
  for (const bound of [from, till]) {
    if (bound !== null && Number.isNaN(Date.parse(bound))) return problem(res, 400);
  }
  const inRange = stored.items.filter((text) => {
    const at = Date.parse((JSON.parse(text) as { submittedAt: string }).submittedAt);
    return (from === null || at > Date.parse(from)) && (till === null || at < Date.parse(till));
  });
  const start = Number(url.searchParams.get("cursor") ?? "0");
  const size = fake.pageSize ?? Number(url.searchParams.get("limit") ?? "500");
  const page = inRange.slice(start, start + size);
  const next = start + size < inRange.length ? JSON.stringify(String(start + size)) : "null";
  const survey = JSON.stringify({
    id: surveyId,
    name: "",
    definition: {},
    ...(stored.privateQuestions !== undefined && { privateQuestions: stored.privateQuestions }),
  });
  res
    .writeHead(200, { "content-type": "application/json" })
    .end(`{"survey":${survey},"items":[${page.join(",")}],"nextCursor":${next}}`);
}

function problem(res: ServerResponse, status: number): void {
  res
    .writeHead(status, { "content-type": "application/problem+json" })
    .end(JSON.stringify({ type: "about:blank", title: "Problem", status }));
}

export async function startFakeStudio(): Promise<FakeStudio> {
  // The handler reads the returned object, so a test's changes apply to the next request.
  const holder: { studio?: FakeStudio } = {};

  const stub = await startStub((request, res) => {
    const fake = holder.studio!;
    if (fake.override?.(request, res) === true) return;
    const url = new URL(request.url, "http://studio");
    if (!url.pathname.startsWith(`${API}/public/`)) return problem(res, 404);
    // e.g. ["surveys", "<id>", "definition"]: the route is "surveys/:/definition".
    const segments = url.pathname
      .slice(`${API}/public/`.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
    const route = `${request.method} ${segments.map((s, i) => (i % 2 === 1 ? ":" : s)).join("/")}`;
    const id = segments[1]!;

    if (request.method === "GET" && segments[0] === "legacy-files" && segments.length === 3) {
      const file = fake.legacyFiles.get(`${segments[1]}/${segments[2]}`);
      return file === undefined ? problem(res, 404) : sendFile(res, file, segments[2]!);
    }

    switch (route) {
      case "GET surveys/:/definition": {
        const stored = fake.definitions.get(id);
        if (!stored) return problem(res, 404);
        const headers: Record<string, string> = { "cache-control": "no-cache" };
        if (stored.etag !== undefined) headers.etag = stored.etag;
        if (stored.etag !== undefined && request.headers["if-none-match"] === stored.etag) {
          res.writeHead(304, headers).end();
          return;
        }
        res
          .writeHead(200, { ...headers, "content-type": "application/json" })
          .end(JSON.stringify(stored.definition));
        return;
      }
      case "GET surveys/:/respondents/:":
      case "GET results/:/respondents/:": {
        const surveyId =
          segments[0] === "surveys"
            ? fake.definitions.has(id)
              ? id
              : undefined
            : fake.resultIds.get(id);
        if (surveyId === undefined) return problem(res, 404);
        return json(res, 200, { state: fake.states.get(`${surveyId}/${segments[3]}`) ?? "none" });
      }
      case "POST posts/:/responses":
        if (!fake.postIds.has(id)) return problem(res, 404);
        return json(res, 201, { id: "r1" });
      case "GET results/:/questions/:": {
        const name = segments[3]!;
        // The contract's limit on a question name.
        if ([...name].length > 256) return problem(res, 400);
        const summary = fake.summaries.get(id);
        if (summary === undefined) return problem(res, 404);
        const question = summary.questions[name] ?? { answered: 0, values: "[]" };
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            `{"answered":${question.answered},"values":${question.values},` +
              `"responseCount":${summary.responseCount},` +
              `"firstSubmittedAt":${JSON.stringify(summary.firstSubmittedAt)},` +
              `"lastSubmittedAt":${JSON.stringify(summary.lastSubmittedAt)}}`,
          );
        return;
      }
      case "GET files/:": {
        const file = fake.files.get(id);
        return file === undefined ? problem(res, 404) : sendFile(res, file, id);
      }
      case "GET surveys/:/results":
        return publicResults(fake, res, id, url);
      case "POST posts/:/files":
        if (!fake.postIds.has(id)) return problem(res, 404);
        return json(res, 201, fake.storedFile);
      default:
        return problem(res, 404);
    }
  });

  const fake: FakeStudio = {
    ...stub,
    definitions: new Map(),
    states: new Map(),
    resultIds: new Map(),
    postIds: new Map(),
    summaries: new Map(),
    files: new Map(),
    legacyFiles: new Map(),
    publicResults: new Map(),
    pageSize: undefined,
    override: undefined,
    storedFile: {
      id: "5af48e08a0a544a583f41c90e8e98de10123456789abcdef0123456789abcdef",
      url: "http://studio.test/api/v1/public/files/5af48e08",
      name: "x",
      contentType: "application/octet-stream",
      size: 1,
    },
    reset(): void {
      fake.definitions.clear();
      fake.states.clear();
      fake.resultIds.clear();
      fake.postIds.clear();
      fake.summaries.clear();
      fake.files.clear();
      fake.legacyFiles.clear();
      fake.publicResults.clear();
      fake.pageSize = undefined;
      fake.requests.length = 0;
      fake.override = undefined;
    },
  };
  holder.studio = fake;
  return fake;
}
