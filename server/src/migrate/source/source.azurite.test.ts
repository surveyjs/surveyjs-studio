import { BlobServiceClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaConfig } from "../../legacy/replica-env.js";
import { readLegacyFixtures, type LegacyFixtures } from "../../providers/azure-legacy/fixtures.js";
import {
  LARGE_SURVEY_POST_ID,
  LARGE_SURVEY_RESPONSES,
} from "../../providers/azure-legacy/large-survey.js";
import { createStubShareReader } from "../../providers/azure-legacy/legacy-shares-stub.js";
import { LAYOUT_CONTAINERS_BY_KIND } from "../../providers/azure-legacy/mapping.js";
import { openLegacySource, type LegacySource } from "./index.js";
import { openSqlSource } from "./sql.js";

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of items) found.push(item);
  return found;
}

const lower = (values: string[]) => values.map((v) => v.toLowerCase()).sort();
const FUTURE = new Date("2999-01-01T00:00:00Z");
const EPOCH = new Date(0);
const MISSING = "22222222-0000-4000-8000-a0000000ffff";

describe("the legacy source readers (local replica)", () => {
  const config = replicaConfig();
  let fixtures: LegacyFixtures;
  let source: LegacySource;
  const blobs = BlobServiceClient.fromConnectionString(config.surveysStorageConnectionString);
  const VIEWS = "my-surveys-views";
  const FILES = "my-surveys-files";
  const viewSurvey = "22222222-0000-4000-8000-a000000000f1";
  const viewUser = "11111111-0000-4000-8000-a000000000f1";
  const written: [string, string][] = [];

  async function put(
    container: string,
    name: string,
    text: string,
    metadata?: Record<string, string>,
  ) {
    const client = blobs.getContainerClient(container);
    await client.createIfNotExists();
    await client.getBlockBlobClient(name).uploadData(Buffer.from(text), { metadata });
    written.push([container, name]);
  }

  beforeAll(async () => {
    fixtures = await readLegacyFixtures();
    source = openLegacySource(config, { shares: createStubShareReader(fixtures.files) });
    await put(VIEWS, `${viewSurvey}/${viewUser}/summary`, '{"a":1}');
    await put(VIEWS, `${viewSurvey}/${viewUser}/table`, "");
    await put(FILES, "abc/def", "bytes", { kind: "asset", name: "x.png" });
  });

  afterAll(async () => {
    for (const [container, name] of written) {
      await blobs
        .getContainerClient(container)
        .deleteBlob(name)
        .catch(() => undefined);
    }
    await source.close();
  });

  it("reads users with access key and time", async () => {
    const users = await collect(source.users());
    expect(lower(users.map((u) => u.id))).toEqual(lower(fixtures.users.map((u) => u.id)));
    const first = fixtures.users[0]!;
    const owner = users.find((u) => u.id.toLowerCase() === first.id.toLowerCase())!;
    expect(owner.accesskey).toBe("access-key-1");
    expect(owner.timestamp).toBeInstanceOf(Date);
    expect(owner.email).toBe(first.email);
  });

  it("reads surveys with theme, projects and project members", async () => {
    const surveys = await collect(source.surveys());
    expect(lower(surveys.map((s) => s.id))).toEqual(lower(fixtures.surveys.map((s) => s.id)));
    expect(surveys.every((s) => "theme" in s)).toBe(true);
    expect(surveys.some((s) => typeof s.theme === "string")).toBe(true);
    const orgs = await collect(source.organizations());
    expect(lower(orgs.map((o) => o.id))).toEqual(lower(fixtures.organizations.map((o) => o.id)));
    const members = await collect(source.organizationUsers());
    expect(lower(members.map((m) => m.id))).toEqual(
      lower(fixtures.organizationUsers.map((m) => m.id)),
    );
  });

  it("reads surveys in pages by id, every row once, the window applied", async () => {
    const paged = openSqlSource(config.sqlConnectionString, { surveyPageSize: 2 });
    try {
      const rows = await collect(paged.surveys());
      expect(lower(rows.map((s) => s.id))).toEqual(lower(fixtures.surveys.map((s) => s.id)));
      expect(new Set(rows.map((s) => s.id)).size).toBe(rows.length);
      expect(rows.some((s) => typeof s.theme === "string")).toBe(true);
      expect(await collect(paged.surveys(FUTURE))).toEqual([]);
      expect((await collect(paged.surveys(EPOCH))).length).toBe(fixtures.surveys.length);
    } finally {
      await paged.close();
    }
  });

  it("filters by time: nothing for the future, everything from the epoch", async () => {
    expect(await collect(source.users(FUTURE))).toEqual([]);
    expect(await collect(source.surveys(FUTURE))).toEqual([]);
    expect(await collect(source.organizations(FUTURE))).toEqual([]);
    expect(await collect(source.organizationUsers(FUTURE))).toEqual([]);
    expect(await collect(source.events(FUTURE))).toEqual([]);
    expect((await collect(source.users(EPOCH))).length).toBe(fixtures.users.length);
    expect((await collect(source.surveys(EPOCH))).length).toBe(fixtures.surveys.length);
  });

  it("reads definitions, ids in any case, and null for none", async () => {
    const withBlob = fixtures.blobs.filter((b) => b.container === "surveyjson");
    expect(withBlob.length).toBeGreaterThan(0);
    for (const blob of withBlob) {
      expect(await source.definitionText(blob.name.toUpperCase())).toBe(
        blob.content.toString("utf8"),
      );
    }
    expect(await source.definitionText(MISSING)).toBeNull();
  });

  it("reads the newest history points, at most keep, newest first", async () => {
    const points = fixtures.blobs.filter((b) => b.container === "surveyjsonhistory");
    const surveyId = points[0]!.name.split("/")[0]!;
    const count = points.filter((b) => b.name.split("/")[0] === surveyId).length;
    const all = await source.historyNewest(surveyId, 20);
    expect(all.length).toBe(Math.min(count, 20));
    expect(all.every((p) => p.text.length > 0)).toBe(true);
    const ats = all.map((p) => Date.parse(p.entry.at));
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);
    expect((await source.historyNewest(surveyId, 1)).length).toBe(1);
    const listed = await source.historyEntries(surveyId.toUpperCase());
    expect(listed.map((e) => e.id)).toEqual(all.map((p) => p.entry.id));
    expect(await source.historyEntries(MISSING)).toEqual([]);
    expect(await source.historyNewest(MISSING, 20)).toEqual([]);
  });

  it("reads layouts and permissions as stored, null for none", async () => {
    for (const [kind, container] of Object.entries(LAYOUT_CONTAINERS_BY_KIND)) {
      for (const blob of fixtures.blobs.filter((b) => b.container === container)) {
        expect(await source.layoutText(blob.name, kind as "table")).toBe(
          blob.content.toString("utf8"),
        );
      }
    }
    for (const blob of fixtures.blobs.filter((b) => b.container === "surveyresultpermissions")) {
      expect(await source.permissionsText(blob.name)).toBe(blob.content.toString("utf8"));
    }
    expect(await source.permissionsText(MISSING)).toBeNull();
    expect(await source.layoutText(MISSING, "table")).toBeNull();
  });

  it("lists views (a zero-byte marker too) and the files container", async () => {
    const views = (await collect(source.views())).filter((v) => v.surveyId === viewSurvey);
    expect(views.map((v) => [v.userId, v.view, v.text]).sort()).toEqual([
      [viewUser, "summary", '{"a":1}'],
      [viewUser, "table", ""],
    ]);
    expect(views[0]!.lastModified).toBeInstanceOf(Date);
    const files = (await collect(source.appFiles())).filter((f) => f.blobName === "abc/def");
    expect(files).toHaveLength(1);
    expect(files[0]!.metadata).toMatchObject({ kind: "asset", name: "x.png" });
    expect(files[0]!.properties.contentLength).toBe(5);
    expect((await source.appFile("abc/def"))?.toString("utf8")).toBe("bytes");
    expect(await source.appFile("abc/none")).toBeNull();
  });

  it("lists changed blobs by last-modified", async () => {
    expect(await collect(source.changedBlobs("views", FUTURE))).toEqual([]);
    expect(await collect(source.changedBlobs("layouts", FUTURE))).toEqual([]);
    expect(await collect(source.changedBlobs("permissions", FUTURE))).toEqual([]);
    expect(await collect(source.changedBlobs("views", EPOCH))).toContain(
      `${viewSurvey}/${viewUser}/summary`,
    );
    const layouts = await collect(source.changedBlobs("layouts", EPOCH));
    const layoutContainers: string[] = Object.values(LAYOUT_CONTAINERS_BY_KIND);
    // One name per survey, whichever kinds it has.
    expect(lower(layouts)).toEqual(
      lower([
        ...new Set(
          fixtures.blobs.filter((b) => layoutContainers.includes(b.container)).map((b) => b.name),
        ),
      ]),
    );
    const permissions = await collect(source.changedBlobs("permissions", EPOCH));
    expect(permissions.length).toBe(
      fixtures.blobs.filter((b) => b.container === "surveyresultpermissions").length,
    );
  });

  it("streams the responses of every table, ids as stored", async () => {
    for (const [table, expected] of Object.entries(fixtures.resultsByTable)) {
      if (table === `post${LARGE_SURVEY_POST_ID.replaceAll("-", "")}`) continue;
      const postId = table.slice("post".length);
      const rows = await collect(source.responses(postId));
      expect(lower(rows.map((r) => r.id))).toEqual(lower(expected.map((r) => r.id)));
      expect(await collect(source.responses(postId, FUTURE))).toEqual([]);
      expect((await collect(source.responses(postId, EPOCH))).length).toBe(expected.length);
    }
    expect(await collect(source.responses(MISSING))).toEqual([]);
  });

  it("streams the large survey's responses in pages", async () => {
    let count = 0;
    const seen = new Set<string>();
    for await (const row of source.responses(LARGE_SURVEY_POST_ID.toUpperCase())) {
      count += 1;
      seen.add(row.id);
      expect(row.timestamp).toBeInstanceOf(Date);
    }
    expect(count).toBe(LARGE_SURVEY_RESPONSES);
    expect(seen.size).toBe(LARGE_SURVEY_RESPONSES);
  });

  it("reads markers, deletion copies and events", async () => {
    const markerTables = fixtures.tables.filter((t) => t.name.slice(0, 16) === "SurveyCompletion");
    expect(markerTables.length).toBeGreaterThan(0);
    for (const table of markerTables) {
      const surveyId = table.name.slice("SurveyCompletion".length);
      const markers = await collect(source.markers(surveyId));
      expect(markers.map((m) => m.clientId).sort()).toEqual(
        table.entities.map((e) => String(e.RowKey)).sort(),
      );
      expect(markers.map((m) => m.partial)).toEqual(
        table.entities.map((e) => e.ispartialcompleted === true),
      );
      expect(await collect(source.markers(surveyId, FUTURE))).toEqual([]);
    }
    const copyTables = fixtures.tables.filter((t) => t.name.slice(0, 10) === "postdelete");
    expect(copyTables.length).toBeGreaterThan(0);
    for (const table of copyTables) {
      const postId = table.name.slice("postdelete".length);
      const copies = await collect(source.deletedCopies(postId));
      expect(lower(copies.map((c) => c.responseId))).toEqual(
        lower(table.entities.map((e) => String(e.instanceid))),
      );
      expect(copies[0]!.deletedAt).toBeInstanceOf(Date);
      expect(copies[0]!.entity.result).toBe(String(table.entities[0]!.result));
      expect(await collect(source.deletedCopies(postId, FUTURE))).toEqual([]);
    }
    const log = fixtures.tables.find((t) => t.account === "surveys" && t.name === "surveys")!;
    const events = await collect(source.events());
    expect(events.length).toBe(log.entities.length);
    const created = events.find((e) => e.type === "SURVEY_CREATE")!;
    expect(created.rest).toHaveProperty("name");
    expect(created.rest).not.toHaveProperty("type");
    expect(created.at).toBeInstanceOf(Date);
    expect(created.timestamp).toBeInstanceOf(Date);
  });

  it("reads share files and lists them", async () => {
    for (const file of fixtures.files) {
      const share = file.share as "surveyfiles" | "files";
      expect(await source.shareFile(share, file.name)).toEqual(file.content);
      expect(await collect(source.shareFiles(share))).toContain(file.name);
    }
    expect(await source.shareFile("files", "nope")).toBeNull();
  });
});

describe("a source without a file service", () => {
  it("reads shares as unknown", async () => {
    const source = openLegacySource(replicaConfig());
    expect(await source.shareFile("files", "99999999-0000-4000-8000-a00000000002.png")).toBeNull();
    await source.close();
  });
});
