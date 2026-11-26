import { beforeEach, describe, expect, it, vi } from "vitest";

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

// The storage SDKs, faked. Tables list the entities `tables` holds under their name; a name in
// `missing` answers 404 (as a table, container or share that does not exist); `refused` 403.
const { tables, blobLists, missing, refused } = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  blobLists: new Map<string, Record<string, unknown>[]>(),
  missing: new Set<string>(),
  refused: new Set<string>(),
}));
const answerFor = (name: string) => {
  if (missing.has(name)) throw Object.assign(new Error("not found"), { statusCode: 404 });
  if (refused.has(name)) throw Object.assign(new Error("refused"), { statusCode: 403 });
};
vi.mock("@azure/data-tables", async (importOriginal) => {
  const real = await importOriginal<typeof import("@azure/data-tables")>();
  return {
    ...real,
    TableClient: {
      fromConnectionString: (_connection: string, name: string) => ({
        listEntities: () => ({
          byPage: () =>
            (async function* () {
              answerFor(name);
              yield tables.get(name) ?? [];
            })(),
        }),
      }),
    },
    TableServiceClient: {
      fromConnectionString: () => ({
        listTables: () =>
          (async function* () {
            answerFor("(table list)");
            yield* [...tables.keys()].map((name) => ({ name }));
          })(),
      }),
    },
  };
});
vi.mock("@azure/storage-blob", async (importOriginal) => {
  const real = await importOriginal<typeof import("@azure/storage-blob")>();
  return {
    ...real,
    BlobServiceClient: {
      fromConnectionString: () => ({
        getContainerClient: (name: string) => ({
          getProperties: async () => {
            answerFor(name);
            return { date: new Date() };
          },
          listBlobsFlat: () =>
            (async function* () {
              answerFor(name);
              yield* blobLists.get(name) ?? [];
            })(),
          getBlobClient: () => ({
            getProperties: async () => {
              throw Object.assign(new Error("not found"), { statusCode: 404 });
            },
          }),
        }),
      }),
    },
  };
});
// The file SDK: a connection string with a file endpoint or an account name gets a fake share
// service; any other goes to the real SDK (which cannot use it).
vi.mock("@azure/storage-file-share", async (importOriginal) => {
  const real = await importOriginal<typeof import("@azure/storage-file-share")>();
  return {
    ...real,
    ShareServiceClient: {
      fromConnectionString: (connection: string) => {
        if (!/FileEndpoint=|AccountName=/.test(connection)) {
          return real.ShareServiceClient.fromConnectionString(connection);
        }
        return {
          getShareClient: (share: string) => ({
            rootDirectoryClient: {
              listFilesAndDirectories: () => ({
                byPage: () => ({
                  next: async () => {
                    answerFor(`share:${share}`);
                    return { done: false, value: { segment: { fileItems: [] } } };
                  },
                }),
              }),
            },
          }),
        };
      },
    },
  };
});

const { openSqlSource } = await import("./sql.js");
const { openShareSource } = await import("./shares.js");
const { openTableSource } = await import("./tables.js");
const { openBlobSource } = await import("./blobs.js");
const { probeLegacySource } = await import("./probe.js");
const { Refused } = await import("../state.js");
const { LegacyStoreError } = await import("../../providers/azure-legacy/errors.js");
const { eventRec } = await import("../copy.js");
const { createReport } = await import("../map/report.js");

beforeEach(() => {
  tables.clear();
  blobLists.clear();
  missing.clear();
  refused.clear();
});

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

  it("gives a deletion copy no deletion time when the row has no date, and always its storage time", async () => {
    tables.set(`postdelete${dashless(POST)}`, [
      row(KEY_1, { instanceid: guid(KEY_2), happendat: AT, result: "{}" }),
      row(KEY_3, { instanceid: guid(KEY_3), result: "{}" }),
    ]);
    const copies = await collect(source().deletedCopies(POST));
    expect(copies.map((c) => [c.responseId, c.deletedAt, c.timestamp])).toEqual([
      [KEY_2, AT, STAMP],
      [KEY_3, null, STAMP],
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

describe("a store that answers 404", () => {
  const POST = "33333333-0000-4000-8000-A00000000001";
  const SURVEY = "22222222-0000-4000-8000-A00000000001";
  const local = {
    surveysStorageConnectionString: "UseDevelopmentStorage=true",
    resultsStorageConnectionString: "UseDevelopmentStorage=true",
  };

  it("is an error for the event table, and no rows for the tables made on first use", async () => {
    const source = openTableSource(local);
    missing.add("surveys");
    await expect(collect(source.events())).rejects.toThrow(LegacyStoreError);
    for (const name of [
      "post33333333000040008000a00000000001",
      "postdelete33333333000040008000a00000000001",
      "SurveyCompletion22222222000040008000a00000000001",
      "mysurveysapitokens",
    ]) {
      missing.add(name);
    }
    expect(await collect(source.responses(POST))).toEqual([]);
    expect(await collect(source.deletedCopies(POST))).toEqual([]);
    expect(await collect(source.markers(SURVEY))).toEqual([]);
    expect(await collect(source.ownTokenRows())).toEqual([]);
  });

  it("is an error for a container every source holds, and empty for those made on first use", async () => {
    const source = openBlobSource("UseDevelopmentStorage=true");
    for (const name of [
      "surveyjsonhistory",
      "surveyresulttablestate",
      "surveyresultsummarystate",
      "surveyresultcolumns",
      "surveyresultpermissions",
      "my-surveys-views",
      "my-surveys-files",
      "surveypublishedjson",
    ]) {
      missing.add(name);
    }
    await expect(source.historyEntries(SURVEY)).rejects.toThrow(LegacyStoreError);
    await expect(collect(source.layoutNames("table"))).rejects.toThrow(LegacyStoreError);
    await expect(collect(source.changedBlobs("layouts", new Date(0)))).rejects.toThrow(
      LegacyStoreError,
    );
    await expect(collect(source.changedBlobs("permissions", new Date(0)))).rejects.toThrow(
      LegacyStoreError,
    );
    expect(await collect(source.views())).toEqual([]);
    expect(await collect(source.appFiles())).toEqual([]);
    expect(await collect(source.changedBlobs("views", new Date(0)))).toEqual([]);
    expect(await collect(source.changedBlobs("published", new Date(0)))).toEqual([]);
  });
});

describe("opening a source: every store the tool reads is checked first", () => {
  const remote = "DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=a2V5";
  const both = (value: string) => ({
    sqlConnectionString: "Server=sql.invalid",
    surveysStorageConnectionString: value,
    resultsStorageConnectionString: value,
  });
  /** The refusal's message; "" when the probe passes. */
  const refusal = async (probe: Promise<void>): Promise<string> => {
    try {
      await probe;
      return "";
    } catch (error) {
      expect(error).toBeInstanceOf(Refused);
      return (error as Error).message;
    }
  };

  it("refuses a remote source whose connection string cannot reach the file shares", async () => {
    // A read-only SAS without a file endpoint.
    const sas =
      "BlobEndpoint=https://acct.blob.core.windows.net/;" +
      "TableEndpoint=https://acct.table.core.windows.net/;" +
      "SharedAccessSignature=sv=2022-11-02&ss=bt&srt=sco&sp=rl&sig=abc";
    const message = await refusal(probeLegacySource(both(sas)));
    expect(message).toContain("share surveyfiles (LEGACY_SURVEYS_STORAGE_CONNECTION_STRING)");
    expect(message).toContain("share files (LEGACY_RESULTS_STORAGE_CONNECTION_STRING)");
    expect(message).not.toContain("sig=abc");
  });

  it("refuses a share that does not exist or cannot be listed, naming it", async () => {
    missing.add("share:files");
    expect(await refusal(probeLegacySource(both(remote)))).toMatch(
      /share files \(LEGACY_RESULTS_STORAGE_CONNECTION_STRING\): it does not exist/,
    );
    missing.clear();
    refused.add("share:surveyfiles");
    expect(await refusal(probeLegacySource(both(remote)))).toMatch(/share surveyfiles .*403/);
  });

  it("takes the local replica (no file service) and a given share reader as reachable", async () => {
    expect(await refusal(probeLegacySource(both("UseDevelopmentStorage=true")))).toBe("");
    const stub = { read: () => Promise.resolve(null) };
    missing.add("share:files");
    expect(await refusal(probeLegacySource(both(remote), { shares: stub }))).toBe("");
    missing.clear();
    expect(await refusal(probeLegacySource(both(remote)))).toBe("");
  });

  it("refuses a source without a container or table every source holds, naming each", async () => {
    missing.add("surveyjsonhistory");
    missing.add("surveys");
    const message = await refusal(probeLegacySource(both("UseDevelopmentStorage=true")));
    expect(message).toMatch(/container surveyjsonhistory.*table surveys/);
    missing.clear();
    refused.add("(table list)");
    expect(await refusal(probeLegacySource(both("UseDevelopmentStorage=true")))).toMatch(
      /table list.*403/,
    );
  });

  it("warns, not silently, when the share reader cannot use a connection string", async () => {
    const sas =
      "BlobEndpoint=https://acct.blob.core.windows.net/;SharedAccessSignature=sv=2022-11-02&sig=abc";
    const warnings: string[] = [];
    const shares = openShareSource(
      { surveysStorageConnectionString: sas, resultsStorageConnectionString: sas },
      undefined,
      (message) => warnings.push(message),
    );
    expect(await shares.shareFile("surveyfiles", "logo.png")).toBeNull();
    expect(warnings.join("\n")).toContain("LEGACY_SURVEYS_STORAGE_CONNECTION_STRING");
    expect(warnings.join("\n")).not.toContain("sig=abc");
  });
});
