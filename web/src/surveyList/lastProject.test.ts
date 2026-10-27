import { describe, expect, it } from "vitest";
import { LAST_PROJECT_KEY_PREFIX, lastProject, rememberProject } from "./lastProject";

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

const OLIVIA = "11111111-0000-4000-8000-a00000000001";
const MIA = "11111111-0000-4000-8000-a00000000003";
const MARKETING = "55555555-0000-4000-8000-a00000000001";

describe("lastProject", () => {
  it("is null when nothing is stored", () => {
    const storage = memoryStorage();
    expect(lastProject(OLIVIA, () => storage)).toBeNull();
  });

  it("reads back what was remembered, for each user apart", () => {
    const storage = memoryStorage();
    rememberProject(OLIVIA, MARKETING, () => storage);
    rememberProject(MIA, "personal", () => storage);
    expect(lastProject(OLIVIA, () => storage)).toBe(MARKETING);
    expect(lastProject(MIA, () => storage)).toBe("personal");
    expect(storage.getItem(LAST_PROJECT_KEY_PREFIX + OLIVIA)).toBe(MARKETING);
  });

  it("keeps the last list only", () => {
    const storage = memoryStorage();
    rememberProject(OLIVIA, MARKETING, () => storage);
    rememberProject(OLIVIA, "personal", () => storage);
    expect(lastProject(OLIVIA, () => storage)).toBe("personal");
  });

  it.each([[""], ["   "], ["x".repeat(65)]])(
    "ignores a stored value %j that is not a list",
    (value) => {
      const storage = memoryStorage({ [LAST_PROJECT_KEY_PREFIX + OLIVIA]: value });
      expect(lastProject(OLIVIA, () => storage)).toBeNull();
    },
  );

  it("is null, and remembering does nothing, when storage throws", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(() => rememberProject(OLIVIA, MARKETING, blocked)).not.toThrow();
    expect(lastProject(OLIVIA, blocked)).toBeNull();
  });
});
