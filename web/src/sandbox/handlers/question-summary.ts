// Mirrors server/src/results/question-summary.ts (ADR 0039 point 5): one question's answers counted
// over folded, completed responses. The sandbox code does not import server/src.

/** One question's answers counted. */
export interface QuestionCounts {
  /** Responses that have the question's name, `null` included. */
  readonly answered: number;
  /** Each distinct value with its count, in first-seen order. */
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

/** Counts the answers under `name` over the responses' data. */
export function summarizeQuestion(
  name: string,
  responses: readonly { data: Record<string, unknown> }[],
): QuestionCounts {
  const counts = new Map<string, { value: unknown; count: number }>();
  let answered = 0;
  for (const { data } of responses) {
    if (!Object.hasOwn(data, name)) continue;
    answered += 1;
    for (const value of counted(data[name])) {
      const key = canonical(value);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { value, count: 1 });
    }
  }
  return { answered, values: [...counts.values()] };
}
