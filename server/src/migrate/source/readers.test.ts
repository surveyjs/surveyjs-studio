import { describe, expect, it, vi } from "vitest";

// The SQL driver, faked: the first connect fails, later ones succeed with an empty table.
const connect = vi.fn();
vi.mock("mssql", () => {
  class ConnectionPool {
    on() {
      return this;
    }
    connect = connect;
    close() {
      return Promise.resolve();
    }
  }
  return { default: { ConnectionPool, DateTime: "DateTime", Int: "Int", UniqueIdentifier: "Uid" } };
});

// The table SDK, faked: each table lists the entities `tables` holds under its name.
const { tables } = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("@azure/data-tables", async (importOriginal) => {
  const real = await importOriginal<typeof import("@azure/data-tables")>();
  return {
    ...real,
    TableClient: {
      fromConnectionString: (_connection: string, name: string) => ({
        listEntities: () => ({
          byPage: () =>
            (async function* () {
              yield tables.get(name) ?? [];
            })(),
        }),
      }),
    },
  };
});

const { openSqlSource } = await import("./sql.js");
const { openShareSource } = await import("./shares.js");
const { openTableSource } = await import("./tables.js");
const { eventRec } = await import("../copy.js");
const { createReport } = await import("../map/report.js");

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of items) found.push(item);
  return found;
}

describe("the SQL reader's connection", () => {
  it("tries again after a failed connect", async () => {
    const request = () => ({
      input() {
        return this;
      },
      query: () => Promise.resolve({ recordset: [] }),
    });
    connect
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ request } as never);
    const source = openSqlSource("Server=127.0.0.1;Database=x;User Id=a;Password=b");
    await expect(collect(source.users())).rejects.toThrow();
    expect(await collect(source.users())).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(2);
    await source.close();
  });
});

describe("a source opened without shares", () => {
  it("lists no share files, even with a remote storage account", async () => {
    const remote =
      "DefaultEndpointsProtocol=https;AccountName=nobody;AccountKey=bm9ib2R5;" +
      "FileEndpoint=https://nobody.invalid";
    const shares = openShareSource(
      { surveysStorageConnectionString: remote, resultsStorageConnectionString: remote },
      null,
    );
    expect(await collect(shares.shareFiles("files"))).toEqual([]);
    expect(await collect(shares.shareFiles("surveyfiles"))).toEqual([]);
    expect(await shares.shareFile("files", "x.png")).toBeNull();
  });
});

describe("the table readers, as the app reads the rows", () => {
  const SURVEY = "22222222-0000-4000-8000-A00000000001";
  const POST = "33333333-0000-4000-8000-A00000000001";
  const KEY_1 = "44444444-0000-4000-8000-A00000000001";
  const KEY_2 = "44444444-0000-4000-8000-A00000000002";
  const KEY_3 = "44444444-0000-4000-8000-A00000000003";
  const USER = "11111111-0000-4000-8000-A00000000001";
  const AT = new Date("2026-03-13T09:12:00.000Z");
  const STAMP = new Date("2026-03-13T09:12:01.000Z");
  const guid = (value: string) => ({ type: "Guid", value });
  const dashless = (id: string) => id.replaceAll("-", "").toLowerCase();
  const source = () =>
    openTableSource({
      surveysStorageConnectionString: "UseDevelopmentStorage=true",
      resultsStorageConnectionString: "UseDevelopmentStorage=true",
    });
  const row = (rowKey: string, extra: Record<string, unknown>) => ({
    partitionKey: "*",
    rowKey,
    etag: "W/x",
    timestamp: STAMP,
    ...extra,
  });

  it("gives a response the row key as its id, and no time when the row has no date", async () => {
    tables.set(`post${dashless(POST)}`, [
      // Both rows carry the same id property: two responses all the same.
      row(KEY_1, { id: guid(KEY_3), happendat: AT, result: "{}" }),
      row(KEY_2, { id: guid(KEY_3), happendat: "2026-03-13T09:12:00Z", result: "{}" }),
      row(KEY_3, { result: "{}" }),
    ]);
    const rows = await collect(source().responses(POST));
    expect(rows.map((r) => [r.id, r.idProperty, r.happendat])).toEqual([
      [KEY_1, KEY_3, AT],
      [KEY_2, KEY_3, null],
      [KEY_3, undefined, null],
    ]);
  });

  it("gives a deletion copy no deletion time when the row has no date", async () => {
    tables.set(`postdelete${dashless(POST)}`, [
      row(KEY_1, { instanceid: guid(KEY_2), happendat: AT, result: "{}" }),
      row(KEY_3, { instanceid: guid(KEY_3), result: "{}" }),
    ]);
    const copies = await collect(source().deletedCopies(POST));
    expect(copies.map((c) => [c.responseId, c.deletedAt])).toEqual([
      [KEY_2, AT],
      [KEY_3, null],
    ]);
  });

  it("gives a marker its stored partial flag", async () => {
    tables.set(`SurveyCompletion${dashless(SURVEY)}`, [
      row("client-a", { ispartialcompleted: true }),
      row("client-b", { ispartialcompleted: "1" }),
      row("client-c", {}),
    ]);
    const markers = await collect(source().markers(SURVEY));
    expect(markers.map((m) => [m.clientId, m.ispartialcompleted])).toEqual([
      ["client-a", true],
      ["client-b", "1"],
      ["client-c", undefined],
    ]);
  });

  describe("events", () => {
    const event = (rowKey: string, extra: Record<string, unknown>) =>
      row(rowKey, { surveyid: guid(SURVEY), type: "SURVEY_CREATE", happendat: AT, ...extra });

    it("drops the pre-port ipaddress and lower-cases the payload's GUIDs (mapping 3.5, N1)", async () => {
      tables.set("surveys", [
        event(KEY_1, {
          id: guid(KEY_1),
          userid: guid(USER),
          creatorid: guid(USER),
          name: KEY_2,
          ipaddress: "203.0.113.5",
        }),
      ]);
      const report = createReport();
      const recs = [];
      for await (const one of source().events()) recs.push(eventRec(one, report));
      expect(recs).toHaveLength(1);
      expect(recs[0]?.id).toBe(KEY_1.toLowerCase());
      expect(JSON.parse(recs[0]!.payload ?? "{}")).toEqual({
        userid: USER.toLowerCase(),
        creatorid: USER.toLowerCase(),
        // A name is text, not an id: as stored.
        name: KEY_2,
      });
      expect(report.counts()).toEqual({});
    });

    it("keys an event by its row key, reports a different id property, and skips a row without a date", async () => {
      tables.set("surveys", [
        event(KEY_1, { id: guid(KEY_2) }),
        event(KEY_3, { id: guid(KEY_3), happendat: "yesterday" }),
      ]);
      const report = createReport();
      const recs = [];
      for await (const one of source().events()) recs.push(eventRec(one, report));
      expect(recs.map((rec) => rec?.id ?? null)).toEqual([KEY_1.toLowerCase(), null]);
      expect(recs[0]?.at).toBe(AT.toISOString());
      expect(report.toJSON()).toMatchObject({
        skipped: [
          {
            entity: "event",
            ids: { eventId: KEY_3.toLowerCase(), surveyId: SURVEY.toLowerCase() },
            reason: "the time is not a date",
          },
        ],
        notes: [
          {
            kind: "event_id_differs",
            ids: { eventId: KEY_1.toLowerCase(), surveyId: SURVEY.toLowerCase() },
          },
        ],
      });
    });
  });
});
