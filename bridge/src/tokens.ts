// The continuation tokens of `getSurveyResults` (ADR 0040 point 5): the bridge's own, opaque, each
// holding a place in Studio's results as the cursor of a page and an offset into it. The old API
// handed out decimal offsets (one engine) or its storage's tokens (the other); a decimal is still
// an offset from the first row, and any other token the bridge did not make starts again at the
// first page, as the old offset engine did with a token it could not read.

/** What every bridge token starts with: no decimal and no storage token of the old API does. */
const PREFIX = "bt1.";

/** The largest offset the old engine read (`int`); a larger decimal did not parse. */
const MAX_OFFSET = 2_147_483_647;

/** A decimal as the old engine's integer parse took it: an optional sign, blanks around. */
const DECIMAL = /^[\t-\r ]*([+-]?)([0-9]+)[\t-\r ]*$/;

/** A token for the place `offset` rows into the page Studio gives for `cursor` (`""`: the first page). */
export function encodeToken(cursor: string, offset: number): string {
  const payload = JSON.stringify({ c: cursor, o: offset });
  return `${PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

/**
 * The place a token names: a bridge token's cursor (none for the first page) and offset; a decimal
 * from the old offset engine as an offset from the first row (negative or larger than the old
 * integer: 0); anything else the first row.
 */
export function decodeToken(text: string): { cursor?: string; offset: number } {
  const decimal = DECIMAL.exec(text);
  if (decimal !== null) {
    const [, sign, digits = ""] = decimal;
    const value = Number(digits);
    if (sign === "-" || value > MAX_OFFSET) return { offset: 0 };
    return { offset: value };
  }
  if (!text.startsWith(PREFIX)) return { offset: 0 };
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(text.slice(PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return { offset: 0 };
  }
  const { c, o } = (payload ?? {}) as { c?: unknown; o?: unknown };
  if (typeof c !== "string" || typeof o !== "number" || !Number.isSafeInteger(o) || o < 0) {
    return { offset: 0 };
  }
  return c === "" ? { offset: o } : { cursor: c, offset: o };
}
