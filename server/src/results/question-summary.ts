import type { SurveyResponse } from "../domain/types.js";

/**
 * The most distinct values a summary lists. A value first seen after that is not listed, but its
 * response still counts in `answered`, so one question cannot make a summary grow without bound.
 */
export const MAX_SUMMARY_VALUES = 10_000;

/** One question's answers counted: the part of `QuestionSummary` that reads the responses. */
export interface QuestionCounts {
  /** Responses that have the question's name, `null` included. */
  readonly answered: number;
  /** Each distinct value with its count, in first-seen order; at most `MAX_SUMMARY_VALUES`. */
  readonly values: { value: unknown; count: number }[];
}

/** A JSON text equal for equal values whatever their key order; types stay apart. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The values one answer counts: array elements, object `[key, value]` pairs, else itself. */
function counted(answer: unknown): unknown[] {
  if (Array.isArray(answer)) return answer;
  if (answer !== null && typeof answer === "object") return Object.entries(answer);
  return [answer];
}

/** Counts the answers under `name` over folded, completed responses (ADR 0039). */
export async function summarizeQuestion(
  name: string,
  responses: AsyncIterable<SurveyResponse>,
): Promise<QuestionCounts> {
  const counts = new Map<string, { value: unknown; count: number }>();
  let answered = 0;
  for await (const { data } of responses) {
    if (!Object.hasOwn(data, name)) continue;
    answered += 1;
    for (const value of counted(data[name])) {
      const key = canonical(value);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else if (counts.size < MAX_SUMMARY_VALUES) counts.set(key, { value, count: 1 });
    }
  }
  return { answered, values: [...counts.values()] };
}

/**
 * The last summaries computed, least recently used first out once `maxEntries` are kept. A key
 * names the survey's completed count and last submission time, so a new response makes it miss.
 */
export class SummaryCache<T> {
  // A Map iterates in insertion order: re-inserting on use keeps the least recently used first.
  private readonly entries = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  static key(
    surveyId: string,
    name: string,
    stats: { count: number; lastSubmittedAt: string | null },
  ): string {
    return JSON.stringify([surveyId, name, stats.count, stats.lastSubmittedAt]);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: T): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
  }
}
