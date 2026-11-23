// The replay's comparison rules (ADR 0041 point 3): the old service's answer is the expected one,
// the bridge's the actual one. Compared: the status, the headers callers read (ADR 0039 point 1),
// and the body: JSON as parsed (property names, their order and values exact; arrays in order but
// for `UNORDERED`), anything else byte for byte. Every other header is ignored: trace ids, `Date`,
// `Server`, platform headers and cookies, chunking and `Content-Length` (equal bodies have equal
// lengths; unequal ones are reported by the body).

/** An answer as read: status, headers (lower-case names) and the body's bytes. */
export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** One place where the answers differ: a path such as `body.json.data[0].name`. */
export interface Difference {
  readonly at: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

/** The headers callers read: compared by value, a missing one as `null`. */
const COMPARED_HEADERS = [
  "content-type",
  "content-disposition",
  "location",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "cache-control",
  "etag",
] as const;

/**
 * By action, the JSON arrays the old service orders by nothing, compared as multisets. A path is
 * written as a difference's, with `[]` for any index (`body.json.groups[].ids`). Each entry says
 * why; add one only with evidence from a replay.
 */
export const UNORDERED: Readonly<Record<string, readonly string[]>> = {};

/** How much of a text or byte body a difference shows: before and after its first difference. */
const BEFORE = 40;
const AFTER = 160;

function isJson(contentType: string | undefined): boolean {
  const media = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return media === "application/json" || media.endsWith("+json");
}

/** A body read as text: no content type, or a textual one. */
function isText(contentType: string | undefined): boolean {
  if (contentType === undefined) return true;
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    media.startsWith("text/") ||
    /[/+](json|xml|javascript|x-www-form-urlencoded)$/.test(media) ||
    /;\s*charset=/i.test(contentType)
  );
}

function parseJson(body: Buffer): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(body.toString("utf8")) as unknown };
  } catch {
    return undefined;
  }
}

/** The part of `whole` around `offset`, with `…` where it was cut. */
function window<T extends { length: number; slice(start: number, end: number): T }>(
  whole: T,
  offset: number,
): { part: T; before: boolean; after: boolean } {
  const start = Math.max(0, offset - BEFORE);
  const end = Math.min(whole.length, offset + AFTER);
  return { part: whole.slice(start, end), before: start > 0, after: end < whole.length };
}

function firstDifference(a: ArrayLike<unknown>, b: ArrayLike<unknown>): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return length;
}

function compareText(expected: string, actual: string, out: Difference[]): void {
  const offset = firstDifference(expected, actual);
  const shown = (text: string) => {
    const { part, before, after } = window(text, offset);
    return `${before ? "…" : ""}${part}${after ? "…" : ""}`;
  };
  out.push({ at: `body.text[${offset}]`, expected: shown(expected), actual: shown(actual) });
}

function compareBytes(expected: Buffer, actual: Buffer, out: Difference[]): void {
  const offset = firstDifference(expected, actual);
  const shown = (bytes: Buffer) => window(bytes, offset).part.toString("base64");
  out.push({ at: `body.bytes[${offset}]`, expected: shown(expected), actual: shown(actual) });
}

const kindOf = (value: unknown) =>
  Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

/** The canonical text of a JSON value, for comparing an unordered array's items. */
const canonical = (value: unknown) => JSON.stringify(value);

function compareJson(
  expected: unknown,
  actual: unknown,
  at: string,
  pattern: string,
  unordered: readonly string[],
  out: Difference[],
): void {
  if (kindOf(expected) !== kindOf(actual)) {
    out.push({ at, expected, actual });
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (unordered.includes(pattern)) {
      const sorted = (items: unknown[]) => items.map(canonical).sort();
      if (canonical(sorted(expected)) !== canonical(sorted(actual))) {
        out.push({ at, expected, actual });
      }
      return;
    }
    if (expected.length !== actual.length) {
      out.push({ at: `${at}.length`, expected: expected.length, actual: actual.length });
    }
    const length = Math.min(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      compareJson(expected[i], actual[i], `${at}[${i}]`, `${pattern}[]`, unordered, out);
    }
    return;
  }
  if (expected !== null && typeof expected === "object") {
    const want = expected as Record<string, unknown>;
    const got = actual as Record<string, unknown>;
    const wantKeys = Object.keys(want);
    const gotKeys = Object.keys(got);
    if (canonical(wantKeys) !== canonical(gotKeys)) {
      out.push({ at, expected: wantKeys, actual: gotKeys });
    }
    for (const key of wantKeys) {
      if (Object.hasOwn(got, key)) {
        compareJson(want[key], got[key], `${at}.${key}`, `${pattern}.${key}`, unordered, out);
      }
    }
    return;
  }
  if (!Object.is(expected, actual)) out.push({ at, expected, actual });
}

/**
 * Every difference between the old service's answer and the bridge's for `action`; empty when
 * they match. `unordered` replaces `UNORDERED` (for tests).
 */
export function compareAnswers(
  oldAnswer: Answer,
  bridgeAnswer: Answer,
  action: string,
  unordered: Readonly<Record<string, readonly string[]>> = UNORDERED,
): Difference[] {
  const out: Difference[] = [];
  if (oldAnswer.status !== bridgeAnswer.status) {
    out.push({ at: "status", expected: oldAnswer.status, actual: bridgeAnswer.status });
  }
  for (const name of COMPARED_HEADERS) {
    const expected = oldAnswer.headers[name] ?? null;
    const actual = bridgeAnswer.headers[name] ?? null;
    if (expected !== actual) out.push({ at: `headers.${name}`, expected, actual });
  }
  if (oldAnswer.body.equals(bridgeAnswer.body)) return out;
  const contentType = oldAnswer.headers["content-type"];
  const oldJson = isJson(contentType) ? parseJson(oldAnswer.body) : undefined;
  if (oldJson !== undefined) {
    const bridgeJson = parseJson(bridgeAnswer.body);
    if (bridgeJson === undefined) {
      out.push({
        at: "body.json",
        expected: oldJson.value,
        actual: bridgeAnswer.body.toString("utf8"),
      });
    } else {
      const paths = unordered[action] ?? [];
      compareJson(oldJson.value, bridgeJson.value, "body.json", "body.json", paths, out);
    }
  } else if (isText(contentType)) {
    compareText(oldAnswer.body.toString("utf8"), bridgeAnswer.body.toString("utf8"), out);
  } else {
    compareBytes(oldAnswer.body, bridgeAnswer.body, out);
  }
  return out;
}
