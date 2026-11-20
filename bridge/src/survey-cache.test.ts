import { describe, expect, it } from "vitest";
import { SurveyCache } from "./survey-cache.js";

const entry = (n: number) => ({ etag: `"v${n}"`, body: `{"n":${n}}` });

describe("the getSurvey cache", () => {
  it("keeps an answer with its ETag", () => {
    const cache = new SurveyCache(10);
    cache.set("a", entry(1));
    expect(cache.get("a")).toEqual(entry(1));
    expect(cache.get("b")).toBeUndefined();
  });

  it("keys surveys in any letter case as one", () => {
    const cache = new SurveyCache(10);
    cache.set("ABC", entry(1));
    expect(cache.get("abc")).toEqual(entry(1));
    cache.delete("aBc");
    expect(cache.get("ABC")).toBeUndefined();
  });

  it("replaces a survey's answer", () => {
    const cache = new SurveyCache(10);
    cache.set("a", entry(1));
    cache.set("a", entry(2));
    expect(cache.get("a")).toEqual(entry(2));
    expect(cache.size).toBe(1);
  });

  it("keeps at most maxEntries surveys, dropping the least recently used", () => {
    const cache = new SurveyCache(2);
    cache.set("a", entry(1));
    cache.set("b", entry(2));
    cache.get("a"); // a is now the most recently used
    cache.set("c", entry(3));
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual(entry(1));
    expect(cache.get("c")).toEqual(entry(3));
  });

  it("keeps nothing with maxEntries 0", () => {
    const cache = new SurveyCache(0);
    cache.set("a", entry(1));
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
