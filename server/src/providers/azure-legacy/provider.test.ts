import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LegacyConfig } from "../../config.js";
import { LegacyStoreError, createAzureLegacyProviders } from "./index.js";

// Nothing listens on port 1: any call that reached SQL or storage would fail.
const SECRET = "Unreachable-Secret-77";
const STORAGE =
  `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${Buffer.from(SECRET).toString("base64")};` +
  "BlobEndpoint=http://127.0.0.1:1/devstoreaccount1;TableEndpoint=http://127.0.0.1:1/devstoreaccount1;";
const unreachable: LegacyConfig = {
  sqlConnectionString: `Server=127.0.0.1,1;Database=d;User Id=sa;Password=${SECRET};Connect Timeout=2`,
  surveysStorageConnectionString: STORAGE,
  resultsStorageConnectionString: STORAGE,
};

describe("azure-legacy provider without a reachable store", () => {
  const providers = createAzureLegacyProviders(unreachable, { readyTimeoutMs: 3_000 });
  afterAll(() => providers.close());

  it.each(["", "survey-1", "not-a-guid", "12345678-1234-1234-1234-1234567890a", "' OR 1=1 --"])(
    "answers a non-GUID id %j without a query",
    async (id) => {
      expect(await providers.surveys.getSurvey(id)).toBeNull();
      expect(await providers.surveys.listSurveys({ kind: "personal", userId: id })).toEqual([]);
      expect(await providers.surveys.listSurveys({ kind: "project", projectId: id })).toEqual([]);
      for (const owner of [
        { kind: "personal", userId: id },
        { kind: "project", projectId: id },
      ] as const) {
        expect(
          await providers.surveys.listSurveyPage({ owner, archived: false, limit: 50 }),
        ).toEqual({ items: [], next: null });
      }
      expect(await providers.surveys.getDefinition(id)).toBeNull();
      expect(await providers.surveys.getTheme(id)).toBeNull();
      expect(
        await providers.surveys.updateSurvey(id, { updatedAt: new Date(0).toISOString() }),
      ).toBeNull();
      expect(await providers.surveys.deleteSurvey(id)).toBe(false);
      expect(await providers.directory.getUser(id)).toBeNull();
      expect(await providers.directory.listUserProjects(id)).toEqual([]);
      const user = "11111111-0000-4000-8000-a00000000001";
      expect(await providers.directory.getUserProject(id, user)).toBeNull();
      expect(await providers.directory.getUserProject(user, id)).toBeNull();
    },
  );

  it.each(["", "not-a-guid", "' OR 1=1 --"])(
    "answers licence notices for a non-GUID id %j without a query",
    async (id) => {
      const licences = createAzureLegacyProviders(unreachable, {
        accountNotices: "surveyjs-licenses",
      });
      try {
        expect(await licences.notices.noticesFor(id)).toEqual([]);
      } finally {
        await licences.close();
      }
    },
  );

  it("serves a demo ACCOUNT_NOTICES setting without a query", async () => {
    const demo = createAzureLegacyProviders(unreachable, {
      accountNotices: "license-expires-soon",
    });
    try {
      const notices = await demo.notices.noticesFor("11111111-0000-4000-8000-a00000000001");
      expect(notices.map((notice) => notice.code)).toEqual(["license-expires-soon"]);
      expect(await providers.notices.noticesFor("11111111-0000-4000-8000-a00000000001")).toEqual(
        [],
      );
    } finally {
      await demo.close();
    }
  });

  it("answers an empty or over-long email without a query", async () => {
    expect(await providers.directory.findUserByEmail("")).toBeNull();
    expect(await providers.directory.findUserByEmail(`${"a".repeat(200)}@example.com`)).toBeNull();
  });

  it("ready resolves false instead of throwing", async () => {
    expect(await providers.ready()).toBe(false);
  });

  it("reports a failed query without any connection-string value", async () => {
    const error = await providers.surveys.getSurvey("22222222-0000-4000-8000-000000000001").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^Legacy store survey lookup failed/);
    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
  });

  describe("createSurvey", () => {
    const valid = {
      id: "22222222-0000-4000-8000-0000000000f1",
      name: "New Survey 1",
      owner: { kind: "personal", userId: "11111111-0000-4000-8000-a00000000001" },
      creatorId: "11111111-0000-4000-8000-a00000000001",
      postId: "33333333-0000-4000-8000-0000000000f1",
      resultId: "44444444-0000-4000-8000-0000000000f1",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    } as const;

    // A store call would fail with a LegacyStoreError; the refusal comes first.
    it.each([
      ["a non-GUID survey id", { id: "../surveyjson/other" }],
      ["a non-GUID owner id", { owner: { kind: "project", projectId: "personal" } }],
      ["a non-GUID creator id", { creatorId: "" }],
      ["a non-GUID post id", { postId: "' OR 1=1 --" }],
      ["a non-GUID result id", { resultId: "not-a-guid" }],
      ["a name over 200 characters", { name: "x".repeat(201) }],
    ] as const)("refuses %s before any write", async (_name, over) => {
      await expect(
        providers.surveys.createSurvey({ ...valid, ...over }, { title: "t" }),
      ).rejects.toThrow(/^Survey create refused/);
    });

    it("reports a failed write without any connection-string value", async () => {
      const error = await providers.surveys.createSurvey(valid).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(LegacyStoreError);
      const message = (error as Error).message;
      expect(message).toMatch(/^Legacy store survey create failed/);
      expect(message).not.toContain("127.0.0.1");
      expect(message).not.toContain(SECRET);
      expect((error as Error).cause).toBeUndefined();
    });
  });

  describe("updateSurvey, cloneSurvey and deleteSurvey", () => {
    const ID = "22222222-0000-4000-8000-0000000000f2";
    const UPDATED_AT = "2026-08-01T10:00:00.000Z";
    const copy = {
      id: "22222222-0000-4000-8000-0000000000f3",
      name: "Copy of New Survey",
      owner: { kind: "personal", userId: "11111111-0000-4000-8000-a00000000001" },
      creatorId: "11111111-0000-4000-8000-a00000000001",
      postId: "33333333-0000-4000-8000-0000000000f3",
      resultId: "44444444-0000-4000-8000-0000000000f3",
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    } as const;

    // A store call would fail with a LegacyStoreError; the refusal comes first.
    it.each([
      [
        "a non-GUID move target",
        { move: { owner: { kind: "project", projectId: "x" }, creatorId: ID } },
      ],
      [
        "a non-GUID mover",
        { move: { owner: { kind: "personal", userId: ID }, creatorId: "' OR 1=1 --" } },
      ],
      ["a name over 200 characters", { name: "x".repeat(201) }],
    ] as const)("refuses an update with %s before any write", async (_name, changes) => {
      await expect(
        providers.surveys.updateSurvey(ID, { ...changes, updatedAt: UPDATED_AT }),
      ).rejects.toThrow(/^Survey update refused/);
    });

    it("answers a clone of a non-GUID source without a query", async () => {
      expect(await providers.surveys.cloneSurvey("../surveyjson/other", copy)).toBeNull();
    });

    it("refuses a clone with a non-GUID copy id before any read", async () => {
      await expect(
        providers.surveys.cloneSurvey(ID, { ...copy, postId: "not-a-guid" }),
      ).rejects.toThrow(/^Survey create refused/);
    });

    it.each([
      ["update", () => providers.surveys.updateSurvey(ID, { name: "n", updatedAt: UPDATED_AT })],
      ["clone", () => providers.surveys.cloneSurvey(ID, copy)],
    ] as const)(
      "reports a failed %s without any connection-string value",
      async (operation, call) => {
        const error = await call().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(LegacyStoreError);
        const message = (error as Error).message;
        expect(message).toMatch(new RegExp(`^Legacy store survey ${operation} failed`));
        expect(message).not.toContain("127.0.0.1");
        expect(message).not.toContain(SECRET);
      },
    );
  });

  it("names the variable, not the value, for an invalid storage connection string", () => {
    const create = () =>
      createAzureLegacyProviders({
        ...unreachable,
        resultsStorageConnectionString: `nonsense ${SECRET}`,
      });
    expect(create).toThrow(/LEGACY_RESULTS_STORAGE_CONNECTION_STRING/);
    expect(create).not.toThrow(new RegExp(SECRET));
  });
});

describe("azure-legacy provider closing while SQL is connecting", () => {
  // Accepts TCP connections and never answers, so a SQL connect stays pending until the
  // driver's connect timeout.
  let silent: Server;
  let port: number;
  let accepted = 0;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    silent = createServer((socket) => {
      accepted += 1;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    port = (silent.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  });

  it("close resolves after a timed-out ready(), and nothing connects afterwards", async () => {
    const providers = createAzureLegacyProviders(
      {
        ...unreachable,
        sqlConnectionString: `Server=127.0.0.1,${port};Database=d;User Id=sa;Password=${SECRET};Connect Timeout=2`,
      },
      { readyTimeoutMs: 200 },
    );
    expect(await providers.ready()).toBe(false); // the SQL connect is still pending
    const pending = providers.surveys.getSurvey("22222222-0000-4000-8000-000000000001").then(
      () => "resolved",
      (e: unknown) => (e as Error).message,
    );
    await expect(providers.close()).resolves.toBeUndefined();
    await expect(providers.close()).resolves.toBeUndefined();
    expect(await pending).toMatch(/^Legacy store survey lookup failed/);

    const before = accepted;
    await expect(
      providers.surveys.getSurvey("22222222-0000-4000-8000-000000000001"),
    ).rejects.toThrow(/^Legacy store survey lookup failed/);
    expect(await providers.ready()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(accepted).toBe(before);
  }, 15_000);
});
