import { describe, expect, it } from "vitest";
import { CLIENT_ID_KEY, createClientIds, perSurveyClientId, randomId } from "./clientId";

/** A Storage over a Map, as `localStorage` behaves. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SURVEY = "7d8a5a9e-1c4b-4e0f-9a51-2f3c4d5e6f70";
const OTHER_SURVEY = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";
/** SHA-256 of `browser-1:7d8a5a9e-1c4b-4e0f-9a51-2f3c4d5e6f70`, in lower-case hex. */
const BROWSER_1_SURVEY = "1c6a05f346f464c35e99c0b89fc436d71730b0024ea15b0705c2843c88933081";

describe("perSurveyClientId", () => {
  it("is the lower-case hex SHA-256 of the browser id and the survey id", async () => {
    await expect(perSurveyClientId("browser-1", SURVEY)).resolves.toBe(BROWSER_1_SURVEY);
  });

  it("ignores the case of the survey id", async () => {
    await expect(perSurveyClientId("browser-1", SURVEY.toUpperCase())).resolves.toBe(
      BROWSER_1_SURVEY,
    );
  });

  it("differs between surveys and between browsers", async () => {
    const ids = await Promise.all([
      perSurveyClientId("browser-1", SURVEY),
      perSurveyClientId("browser-1", OTHER_SURVEY),
      perSurveyClientId("browser-2", SURVEY),
    ]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("client ids", () => {
  it("has no stored id on empty storage", async () => {
    const storage = memoryStorage();

    await expect(createClientIds(SURVEY, { storage: () => storage }).stored()).resolves.toBeNull();
  });

  it("ensure() stores a new UUID as the browser id and sends the survey's id, not it", async () => {
    const storage = memoryStorage();
    const ids = createClientIds(SURVEY, { storage: () => storage });

    const id = await ids.ensure();

    const browserId = storage.getItem(CLIENT_ID_KEY);
    expect(browserId).toMatch(UUID);
    expect(id).toMatch(SHA256_HEX);
    expect(id).not.toBe(browserId);
    expect(id).toBe(await perSurveyClientId(browserId!, SURVEY));
    await expect(ids.ensure()).resolves.toBe(id);
    await expect(ids.stored()).resolves.toBe(id);
    await expect(createClientIds(SURVEY, { storage: () => storage }).stored()).resolves.toBe(id);
  });

  it("derives the same id on a later visit and another one for another survey", async () => {
    const storage = memoryStorage({ [CLIENT_ID_KEY]: "browser-1" });

    await expect(createClientIds(SURVEY, { storage: () => storage }).ensure()).resolves.toBe(
      BROWSER_1_SURVEY,
    );
    await expect(
      createClientIds(SURVEY.toUpperCase(), { storage: () => storage }).stored(),
    ).resolves.toBe(BROWSER_1_SURVEY);
    const other = await createClientIds(OTHER_SURVEY, { storage: () => storage }).ensure();
    expect(other).toMatch(SHA256_HEX);
    expect(other).not.toBe(BROWSER_1_SURVEY);
    expect(other).not.toBe("browser-1");
    // The browser id itself is kept as it is.
    expect(storage.getItem(CLIENT_ID_KEY)).toBe("browser-1");
  });

  it.each([
    ["257 characters", "x".repeat(257)],
    ["empty", ""],
    ["a slash", "a/b"],
    ["a control character", "a\u0001b"],
  ])("ignores a stored value with %s", async (_, value) => {
    const storage = memoryStorage({ [CLIENT_ID_KEY]: value });
    const ids = createClientIds(SURVEY, { storage: () => storage, newId: () => "new-id" });

    await expect(ids.stored()).resolves.toBeNull();
    await expect(ids.ensure()).resolves.toBe(await perSurveyClientId("new-id", SURVEY));
    expect(storage.getItem(CLIENT_ID_KEY)).toBe("new-id");
  });

  it("keeps a browser id of 256 characters", async () => {
    const value = "x".repeat(256);
    const storage = memoryStorage({ [CLIENT_ID_KEY]: value });

    await expect(createClientIds(SURVEY, { storage: () => storage }).stored()).resolves.toBe(
      await perSurveyClientId(value, SURVEY),
    );
  });

  it("returns one id for the page load when storage cannot be reached", async () => {
    let created = 0;
    const ids = createClientIds(SURVEY, {
      storage: () => {
        throw new Error("SecurityError");
      },
      newId: () => `id-${++created}`,
    });

    await expect(ids.stored()).resolves.toBeNull();
    const id = await ids.ensure();
    expect(id).toBe(await perSurveyClientId("id-1", SURVEY));
    await expect(ids.ensure()).resolves.toBe(id);
  });

  it("returns one id for the page load when storage refuses writes", async () => {
    let created = 0;
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const ids = createClientIds(SURVEY, { storage: () => storage, newId: () => `id-${++created}` });

    const id = await ids.ensure();
    expect(id).toBe(await perSurveyClientId("id-1", SURVEY));
    await expect(ids.ensure()).resolves.toBe(id);
    await expect(ids.stored()).resolves.toBeNull();
  });

  describe("without Web Crypto digests", () => {
    const noDigest = { subtle: () => undefined };

    it("never sends the stored browser id", async () => {
      const storage = memoryStorage({ [CLIENT_ID_KEY]: "browser-1" });
      const ids = createClientIds(SURVEY, {
        ...noDigest,
        storage: () => storage,
        newId: () => "page-load-id",
      });

      await expect(ids.stored()).resolves.toBeNull();
      await expect(ids.ensure()).resolves.toBe("page-load-id");
      await expect(ids.ensure()).resolves.toBe("page-load-id");
      expect(storage.getItem(CLIENT_ID_KEY)).toBe("browser-1");
    });

    it("stores nothing and returns a random id for the page load", async () => {
      const storage = memoryStorage();
      let created = 0;
      const ids = createClientIds(SURVEY, {
        ...noDigest,
        storage: () => storage,
        newId: () => `id-${++created}`,
      });

      await expect(ids.ensure()).resolves.toBe("id-1");
      await expect(ids.ensure()).resolves.toBe("id-1");
      expect(storage.getItem(CLIENT_ID_KEY)).toBeNull();
    });
  });
});

describe("randomId", () => {
  it("makes a version 4 UUID without crypto.randomUUID (outside a secure context)", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () =>
        randomId({ getRandomValues: (array) => crypto.getRandomValues(array) }),
      ),
    );

    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});
