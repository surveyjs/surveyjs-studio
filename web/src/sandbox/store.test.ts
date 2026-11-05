import { afterEach, describe, expect, it } from "vitest";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { DEFAULT_SETTINGS } from "./settings";
import {
  SESSION_COOKIE,
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
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("keeps a write across a reload", () => {
    const storage = memoryStorage();
    make(storage).write(rename("Changed"));
    expect(make(storage).read().surveys[0]?.name).toBe("Changed");
  });

  it("shows one store's write to another on the same storage", () => {
    const storage = memoryStorage();
    const a = make(storage);
    const b = make(storage);
    a.read();
    a.write(rename("From A"));
    expect(b.read().surveys[0]?.name).toBe("From A");
    b.write((d) => {
      d.projects[0]!.name = "From B";
    });
    const after = a.read();
    expect(after.surveys[0]?.name).toBe("From A");
    expect(after.projects[0]?.name).toBe("From B");
  });

  it.each([
    ["a different version", JSON.stringify({ ...seed, version: 0 })],
    ["unparsable JSON", "{"],
    ["a missing collection", JSON.stringify({ version: 1, users: [] })],
    ["a non-object", "null"],
  ])("reseeds a stored document with %s", (_name, stored) => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, stored);
    const data = make(storage).read();
    expect(data.surveys).toEqual(seed.surveys);
    expect(make(storage).read().version).toBe(1);
  });

  it("refuses a write that reaches the limit and leaves the document unchanged", () => {
    const storage = memoryStorage();
    const store = make(storage);
    store.read();
    const before = storage.getItem(STORAGE_KEY);
    const small = make(storage, store.usedKb() + 1);
    expect(() =>
      small.write((d) => {
        d.files.push(file("x".repeat(4096)));
      }),
    ).toThrow(StorageFullError);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(small.read().files).toEqual([]);
    expect(small.isFull()).toBe(false);
  });

  it("refuses a write when the browser throws QuotaExceededError", () => {
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
    store.read();
    const before = inner.getItem(STORAGE_KEY);
    failing = true;
    expect(() => store.write(rename("X"))).toThrow(StorageFullError);
    expect(inner.getItem(STORAGE_KEY)).toBe(before);
    expect(store.read().surveys[0]?.name).toBe(seed.surveys[0]?.name);
  });

  it("leaves the stored document untouched when change throws", () => {
    const storage = memoryStorage();
    const store = make(storage);
    store.read();
    const before = storage.getItem(STORAGE_KEY);
    expect(() =>
      store.write((d) => {
        d.surveys.length = 0;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("uses the value change returns", () => {
    const store = make();
    const result = store.write((d) => ({ ...d, surveys: [] }));
    expect(result.surveys).toEqual([]);
    expect(store.read().surveys).toEqual([]);
  });

  it("counts the serialised size (UTF-16 units x 2) in KB", () => {
    const storage = memoryStorage();
    const store = make(storage);
    store.read();
    expect(store.usedKb()).toBe(((storage.getItem(STORAGE_KEY) ?? "").length * 2) / 1024);
  });

  it("resets to the seed and leaves the app's own keys alone (D2)", () => {
    const storage = memoryStorage();
    storage.setItem("my-surveys.client-id", "cid");
    storage.setItem("OnlineEditorSurveyCreatorThemeV3", "{}");
    const a = make(storage);
    a.write(rename("Changed"));
    a.reset();
    expect(a.read().surveys).toEqual(seed.surveys);
    expect(storage.getItem("my-surveys.client-id")).toBe("cid");
    expect(storage.getItem("OnlineEditorSurveyCreatorThemeV3")).toBe("{}");
  });

  it("shows the seed to another store after a reset (Review Focus 5)", () => {
    const storage = memoryStorage();
    const a = make(storage);
    const b = make(storage);
    b.write(rename("Changed"));
    a.reset();
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
