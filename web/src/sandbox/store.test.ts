import { afterEach, describe, expect, it } from "vitest";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { DEFAULT_SETTINGS } from "./settings";
import {
  SESSION_COOKIE,
  SandboxOutdatedError,
  STORAGE_KEY,
  StorageFullError,
  createSandboxStore,
  memoryStorage,
  setSessionCookie,
  type KeyValueStorage,
} from "./store";

const seed = seedJson as unknown as SandboxSeed;

function make(
  storage: KeyValueStorage = memoryStorage(),
  storageLimitKb = DEFAULT_SETTINGS.storageLimitKb,
) {
  return createSandboxStore({ storage, seed, settings: { ...DEFAULT_SETTINGS, storageLimitKb } });
}

const rename = (name: string) => (data: { surveys: { name: string }[] }) => {
  data.surveys[0]!.name = name;
};

function file(base64: string) {
  return {
    id: "f1",
    surveyId: null,
    name: "a.png",
    contentType: "image/png",
    size: base64.length,
    base64,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("sandbox store", () => {
  it("seeds on the first read", () => {
    const storage = memoryStorage();
    const data = make(storage).read();
    expect(data.version).toBe(1);
    expect(data.surveys).toEqual(seed.surveys);
    expect(data.files).toEqual([]);
    // Stored holding the lock; without one (here) at once.
    expect(storage.getItem(STORAGE_KEY)).toMatch(/^\{"revision":1,/);
  });

  it("keeps a write across a reload", async () => {
    const storage = memoryStorage();
    await make(storage).write(rename("Changed"));
    expect(make(storage).read().surveys[0]?.name).toBe("Changed");
  });

  it("counts the writes in revision, first in the stored text", async () => {
    const storage = memoryStorage();
    const store = make(storage);
    expect((await store.write(() => {})).revision).toBe(1);
    expect((await store.write((d) => ({ ...d, revision: 99, surveys: [] }))).revision).toBe(2);
    expect(storage.getItem(STORAGE_KEY)).toMatch(/^\{"revision":2,/);
    expect(store.read().revision).toBe(2);
  });

  it("shows one store's write to another on the same storage", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    const b = make(storage);
    a.read();
    await a.write(rename("From A"));
    expect(b.read().surveys[0]?.name).toBe("From A");
    await b.write((d) => {
      d.projects[0]!.name = "From B";
    });
    const after = a.read();
    expect(after.surveys[0]?.name).toBe("From A");
    expect(after.projects[0]?.name).toBe("From B");
  });

  it.each([
    ["unparsable JSON", "{"],
    ["a missing collection", JSON.stringify({ version: 1, users: [] })],
    ["a non-object", "null"],
  ])("reseeds a stored document with %s", async (_name, stored) => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, stored);
    const data = make(storage).read();
    expect(data.surveys).toEqual(seed.surveys);
    expect(make(storage).status()).toBe("current");
  });

  describe("the data version", () => {
    const stored = (version: number) =>
      JSON.stringify({ ...seed, files: [], idempotencyKeys: {}, savedViews: {}, version });

    it.each([
      ["an empty storage", null],
      ["unparsable JSON", "{"],
      ["a document without collections", JSON.stringify({ version: 1 })],
    ])("is fresh for %s", (_name, text) => {
      const storage = memoryStorage();
      if (text !== null) storage.setItem(STORAGE_KEY, text);
      expect(make(storage).status()).toBe("fresh");
    });

    it("is current after a read", () => {
      const store = make();
      store.read();
      expect(store.status()).toBe("current");
    });

    it("is outdated for another version, which is neither read, written nor overwritten", async () => {
      const storage = memoryStorage();
      const text = stored(0);
      storage.setItem(STORAGE_KEY, text);
      const store = make(storage);
      expect(store.status()).toBe("outdated");
      expect(() => store.read()).toThrow(SandboxOutdatedError);
      await expect(store.write(() => {})).rejects.toThrow(SandboxOutdatedError);
      expect(storage.getItem(STORAGE_KEY)).toBe(text);
      await store.reset();
      expect(store.status()).toBe("current");
    });

    it("is outdated for a newer version too", () => {
      const storage = memoryStorage();
      storage.setItem(STORAGE_KEY, stored(2));
      expect(make(storage).status()).toBe("outdated");
    });
  });

  it("refuses a write that reaches the limit and leaves the document unchanged", async () => {
    const storage = memoryStorage();
    const store = make(storage);
    await store.write(() => {});
    const before = storage.getItem(STORAGE_KEY);
    const small = make(storage, store.usedKb() + 1);
    await expect(
      small.write((d) => {
        d.files.push(file("x".repeat(4096)));
      }),
    ).rejects.toThrow(StorageFullError);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(small.read().files).toEqual([]);
    expect(small.isFull()).toBe(false);
  });

  describe("the limit, exactly", () => {
    // One UTF-16 code unit more is 2 bytes: 2 / 1024 KB.
    const UNIT_KB = 2 / 1024;

    async function stored(): Promise<{ storage: KeyValueStorage; kb: number }> {
      const storage = memoryStorage();
      const store = make(storage);
      await store.write(() => {});
      return { storage, kb: store.usedKb() };
    }

    const copyOf = (storage: KeyValueStorage): KeyValueStorage => {
      const copy = memoryStorage();
      copy.setItem(STORAGE_KEY, storage.getItem(STORAGE_KEY)!);
      return copy;
    };

    it("isFull is true at the limit and above it, false below it", async () => {
      const { storage, kb } = await stored();
      expect(make(storage, kb).isFull()).toBe(true);
      expect(make(storage, kb - UNIT_KB).isFull()).toBe(true);
      expect(make(storage, kb + UNIT_KB).isFull()).toBe(false);
    });

    it("refuses a write whose result is exactly at the limit, and stores one a unit below it", async () => {
      const { storage, kb } = await stored();
      // The same write on a copy gives the size the next document has.
      const copy = copyOf(storage);
      await make(copy, Infinity).write(() => {});
      const nextKb = make(copy).usedKb();
      await expect(make(storage, nextKb).write(() => {})).rejects.toThrow(StorageFullError);
      expect(make(storage).usedKb()).toBe(kb);
      await make(storage, nextKb + UNIT_KB).write(() => {});
      expect(make(storage).usedKb()).toBe(nextKb);
    });
  });

  it("refuses a write when the browser throws QuotaExceededError", async () => {
    const inner = memoryStorage();
    let failing = false;
    const storage: KeyValueStorage = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: (k, v) => {
        if (failing) throw new DOMException("full", "QuotaExceededError");
        inner.setItem(k, v);
      },
    };
    const store = make(storage);
    await store.write(() => {});
    const before = inner.getItem(STORAGE_KEY);
    failing = true;
    await expect(store.write(rename("X"))).rejects.toThrow(StorageFullError);
    expect(inner.getItem(STORAGE_KEY)).toBe(before);
    expect(store.read().surveys[0]?.name).toBe(seed.surveys[0]?.name);
  });

  it("leaves the stored document untouched when change throws", async () => {
    const storage = memoryStorage();
    const store = make(storage);
    await store.write(() => {});
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      store.write((d) => {
        d.surveys.length = 0;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("uses the value change returns", async () => {
    const store = make();
    const result = await store.write((d) => ({ ...d, surveys: [] }));
    expect(result.surveys).toEqual([]);
    expect(store.read().surveys).toEqual([]);
  });

  it("counts the serialised size (UTF-16 units x 2) in KB", async () => {
    const storage = memoryStorage();
    const store = make(storage);
    expect(store.usedKb()).toBe(0);
    store.read();
    expect(store.usedKb()).toBe(((storage.getItem(STORAGE_KEY) ?? "").length * 2) / 1024);
  });

  it("resets to the seed and leaves the app's own keys alone (D2)", async () => {
    const storage = memoryStorage();
    storage.setItem("my-surveys.client-id", "cid");
    storage.setItem("OnlineEditorSurveyCreatorThemeV3", "{}");
    const a = make(storage);
    await a.write(rename("Changed"));
    await a.reset();
    expect(a.read().surveys).toEqual(seed.surveys);
    expect(a.read().revision).toBe(2);
    expect(storage.getItem("my-surveys.client-id")).toBe("cid");
    expect(storage.getItem("OnlineEditorSurveyCreatorThemeV3")).toBe("{}");
  });

  it("rejects a reset the browser refuses with StorageFullError, not the raw error", async () => {
    const inner = memoryStorage();
    const denied = new DOMException("denied", "SecurityError");
    const storage: KeyValueStorage = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: () => {
        throw denied;
      },
    };
    const failure = await make(storage)
      .reset()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(StorageFullError);
    expect((failure as Error).cause).toBe(denied);
  });

  it("shows the seed to another store after a reset (Review Focus 5)", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    const b = make(storage);
    await b.write(rename("Changed"));
    await a.reset();
    expect(b.read().surveys[0]?.name).toBe(seed.surveys[0]?.name);
  });
});

describe("setSessionCookie", () => {
  afterEach(() => setSessionCookie(null));

  it("sets and clears msid", () => {
    setSessionCookie("u1");
    expect(document.cookie).toContain(`${SESSION_COOKIE}=u1`);
    setSessionCookie(null);
    expect(document.cookie).not.toContain(SESSION_COOKIE);
  });
});
