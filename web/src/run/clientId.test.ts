import { describe, expect, it } from "vitest";
import { CLIENT_ID_KEY, createClientIds } from "./clientId";

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

describe("client ids", () => {
  it("has no stored id on empty storage", () => {
    const storage = memoryStorage();

    expect(createClientIds(() => storage).stored()).toBeNull();
  });

  it("ensure() writes a new UUID and returns it again", () => {
    const storage = memoryStorage();
    const ids = createClientIds(() => storage);

    const id = ids.ensure();

    expect(id).toMatch(UUID);
    expect(storage.getItem(CLIENT_ID_KEY)).toBe(id);
    expect(ids.ensure()).toBe(id);
    expect(ids.stored()).toBe(id);
    expect(createClientIds(() => storage).stored()).toBe(id);
  });

  it("reuses an existing id", () => {
    const storage = memoryStorage({ [CLIENT_ID_KEY]: "existing-id" });
    const ids = createClientIds(() => storage);

    expect(ids.stored()).toBe("existing-id");
    expect(ids.ensure()).toBe("existing-id");
  });

  it.each([
    ["257 characters", "x".repeat(257)],
    ["empty", ""],
    ["a slash", "a/b"],
    ["a control character", "a\u0001b"],
  ])("ignores a stored value with %s", (_, value) => {
    const storage = memoryStorage({ [CLIENT_ID_KEY]: value });
    const ids = createClientIds(
      () => storage,
      () => "new-id",
    );

    expect(ids.stored()).toBeNull();
    expect(ids.ensure()).toBe("new-id");
    expect(storage.getItem(CLIENT_ID_KEY)).toBe("new-id");
  });

  it("keeps a value of 256 characters", () => {
    const value = "x".repeat(256);
    const storage = memoryStorage({ [CLIENT_ID_KEY]: value });

    expect(createClientIds(() => storage).stored()).toBe(value);
  });

  it("returns one id for the instance when storage cannot be reached", () => {
    let created = 0;
    const ids = createClientIds(
      () => {
        throw new Error("SecurityError");
      },
      () => `id-${++created}`,
    );

    expect(ids.stored()).toBeNull();
    expect(ids.ensure()).toBe("id-1");
    expect(ids.ensure()).toBe("id-1");
  });

  it("returns one id for the instance when storage refuses writes", () => {
    let created = 0;
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const ids = createClientIds(
      () => storage,
      () => `id-${++created}`,
    );

    expect(ids.ensure()).toBe("id-1");
    expect(ids.ensure()).toBe("id-1");
    expect(ids.stored()).toBeNull();
  });
});
