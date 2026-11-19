import { describe, expect, it } from "vitest";
import type { SurveyResponse } from "../domain/types.js";
import { MAX_SUMMARY_VALUES, SummaryCache, summarizeQuestion } from "./question-summary.js";

async function* of(...datas: Record<string, unknown>[]): AsyncGenerator<SurveyResponse> {
  let n = 0;
  for (const data of datas) {
    n += 1;
    yield { id: `id-${n}`, submittedAt: "2026-01-01T00:00:00.000Z", data, partial: false };
  }
}

const summary = (name: string, ...datas: Record<string, unknown>[]) =>
  summarizeQuestion(name, of(...datas));

describe("summarizeQuestion", () => {
  it("counts each element of an array answer", async () => {
    expect(await summary("q", { q: [1, 2] }, { q: [2] })).toStrictEqual({
      answered: 2,
      values: [
        { value: 1, count: 1 },
        { value: 2, count: 2 },
      ],
    });
  });

  it("counts each property of an object answer as [key, value]", async () => {
    const result = await summary("q", { q: { r1: "c1" } }, { q: { r1: "c1", r2: "c2" } });
    expect(result.values).toStrictEqual([
      { value: ["r1", "c1"], count: 2 },
      { value: ["r2", "c2"], count: 1 },
    ]);
  });

  it("keeps the JSON type: 1 and '1' are two values, true and 'true' too", async () => {
    const result = await summary("q", { q: 1 }, { q: "1" }, { q: true }, { q: "true" }, { q: 1 });
    expect(result.values).toStrictEqual([
      { value: 1, count: 2 },
      { value: "1", count: 1 },
      { value: true, count: 1 },
      { value: "true", count: 1 },
    ]);
  });

  it("counts a null answer as answered and as the value null", async () => {
    expect(await summary("q", { q: null }, { other: 1 })).toStrictEqual({
      answered: 1,
      values: [{ value: null, count: 1 }],
    });
  });

  it("does not count responses without the question", async () => {
    expect(await summary("q", { a: 1 }, {})).toStrictEqual({ answered: 0, values: [] });
  });

  it("matches only answer keys, never metadata", async () => {
    const response: SurveyResponse = {
      id: "x",
      submittedAt: "2026-01-01T00:00:00.000Z",
      data: { q: 1 },
      partial: false,
    };
    async function* one() {
      yield response;
    }
    expect(await summarizeQuestion("submittedAt", one())).toStrictEqual({
      answered: 0,
      values: [],
    });
    expect(await summary("submittedAt", { submittedAt: "x" })).toStrictEqual({
      answered: 1,
      values: [{ value: "x", count: 1 }],
    });
  });

  it("counts nested elements as whole JSON values, regardless of key order", async () => {
    const result = await summary("q", { q: [[1], { a: 1, b: 2 }] }, { q: [[1], { b: 2, a: 1 }] });
    expect(result.values).toStrictEqual([
      { value: [1], count: 2 },
      { value: { a: 1, b: 2 }, count: 2 },
    ]);
  });

  it("keeps first-seen order", async () => {
    const result = await summary("q", { q: "b" }, { q: "a" }, { q: "b" });
    expect(result.values.map((v) => v.value)).toStrictEqual(["b", "a"]);
  });
});

describe("the distinct-value cap", () => {
  it(`lists at most ${MAX_SUMMARY_VALUES} values and still counts every answer`, async () => {
    const datas = Array.from({ length: MAX_SUMMARY_VALUES + 5 }, (_, n) => ({ q: n }));
    // A value listed before the cap keeps counting after it.
    datas.push({ q: 0 });
    const result = await summary("q", ...datas);
    expect(result.answered).toBe(MAX_SUMMARY_VALUES + 6);
    expect(result.values).toHaveLength(MAX_SUMMARY_VALUES);
    expect(result.values[0]).toStrictEqual({ value: 0, count: 2 });
    expect(result.values.at(-1)).toStrictEqual({ value: MAX_SUMMARY_VALUES - 1, count: 1 });
  });
});

describe("SummaryCache", () => {
  const stats = (count: number) => ({ count, lastSubmittedAt: `2026-01-0${count}T00:00:00.000Z` });

  it("keys on the survey, the name and the survey's count and last submission", () => {
    expect(SummaryCache.key("s", "q", stats(1))).not.toBe(SummaryCache.key("s", "q", stats(2)));
    expect(SummaryCache.key("s", "q", stats(1))).not.toBe(SummaryCache.key("s", "r", stats(1)));
    expect(SummaryCache.key("s", "q", stats(1))).toBe(SummaryCache.key("s", "q", stats(1)));
  });

  it("drops the least recently used entry first", () => {
    const cache = new SummaryCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });
});
