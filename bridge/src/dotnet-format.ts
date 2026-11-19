// The old API's value formats (ADR 0039 point 1: formats of values callers parse). Its JSON
// serializer read date-like strings as dates and wrote them back in its own form, wrote numbers
// with a fraction or an exponent as doubles, keyed `getResult`'s `QuestionResult` by the
// platform's invariant texts (`True`, `[row1, col1]`, `05/01/2026 10:00:00`), wrote times with up
// to 7 fractional digits, parsed `from`/`till` leniently and named downloads in a header of its
// platform's form. The server's time zone is taken as UTC.
//
// Every function here runs in linear time on any input: scans, and only regular expressions
// without ambiguous repetition.

/** A JSON number from Studio with its text, so `1.0` stays apart from `1`. */
export class JsonNumber {
  constructor(readonly text: string) {}

  /** Whether the old reader read it as a double: it has a fraction or an exponent. */
  get isFloat(): boolean {
    return /[.eE]/.test(this.text);
  }
}

/**
 * Parses Studio's JSON with every number as a {@link JsonNumber} holding its text (JSON.parse's
 * source text access). Throws a `SyntaxError` on malformed JSON.
 */
export function parseStudioJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === "number" ? new JsonNumber(context?.source ?? String(value)) : value,
  );
}

/**
 * A double as the old platform's invariant text: the shortest digits that read back as the value,
 * in scientific form (`1E+21`, `1E-05`) when the decimal point would sit more than 15 places (or
 * the digit count, if larger) to the right or more than 3 zeros to the left of the digits.
 */
export function dotnetDouble(value: number): string {
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const [mantissa = "", exponent = "0"] = Math.abs(value).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const power = Number(exponent);
  // How many digits stand before the decimal point.
  const scale = power + 1;
  const sign = value < 0 ? "-" : "";
  if (scale > Math.max(digits.length, 15) || scale < -3) {
    const fraction = digits.length > 1 ? `.${digits.slice(1)}` : "";
    const size = Math.abs(power);
    return `${sign}${digits[0]}${fraction}E${power < 0 ? "-" : "+"}${size < 10 ? "0" : ""}${size}`;
  }
  if (scale <= 0) return `${sign}0.${"0".repeat(-scale)}${digits}`;
  if (scale >= digits.length) return `${sign}${digits}${"0".repeat(scale - digits.length)}`;
  return `${sign}${digits.slice(0, scale)}.${digits.slice(scale)}`;
}

/** A JSON number's text as the old serializer wrote it back: integers as read, doubles with `.0`. */
export function oldNumberText(text: string): string {
  if (!/[.eE]/.test(text)) return text === "-0" ? "0" : text;
  const written = dotnetDouble(Number(text));
  return /[.E]/.test(written) ? written : `${written}.0`;
}

/** A date the old reader made of a date-like string. */
export interface OldDateTime {
  /** The wall time, whole seconds, as milliseconds since the epoch (UTC for `utc` and `local`). */
  readonly ms: number;
  /** The 7 fractional digits (the platform's ticks). */
  readonly fraction: string;
  /** `Z` → `utc`; an offset → `local` (converted to the server's time, UTC); none → `unspecified`. */
  readonly kind: "utc" | "local" | "unspecified";
}

/** The digit at `index`, or -1. */
function digitAt(text: string, index: number): number {
  const value = text.charCodeAt(index) - 48;
  return value >= 0 && value <= 9 ? value : -1;
}

/** `count` digits from `start` as a number, or -1 when any is missing or not a digit. */
function digitsAt(text: string, start: number, count: number): number {
  let value = 0;
  for (let index = start; index < start + count; index += 1) {
    const digit = digitAt(text, index);
    if (digit < 0) return -1;
    value = value * 10 + digit;
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Milliseconds since the epoch of a UTC wall time (years below 100 included; hour 24 rolls over). */
function epochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** The platform's range of dates: 0001-01-01T00:00:00 to 9999-12-31T23:59:59. */
const MIN_MS = epochMs(1, 1, 1, 0, 0, 0);
const MAX_MS = epochMs(9999, 12, 31, 23, 59, 59);

/**
 * A string the old reader read as a date: 19 to 40 characters, a digit first and `T` at index 10,
 * then `yyyy-MM-ddTHH:mm:ss`, up to 7 fractional digits, and `Z` or an offset (`±HH`, `±HHmm`,
 * `±HH:mm`) — its parser's exact rules, quirks included. `null` when it is not one.
 */
export function parseOldDate(text: string): OldDateTime | null {
  const end = text.length;
  if (end < 19 || end > 40 || digitAt(text, 0) < 0 || text[10] !== "T") return null;
  const year = digitsAt(text, 0, 4);
  const month = digitsAt(text, 5, 2);
  const day = digitsAt(text, 8, 2);
  if (year < 1 || text[4] !== "-" || month < 1 || month > 12 || text[7] !== "-") return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const hour = digitsAt(text, 11, 2);
  const minute = digitsAt(text, 14, 2);
  const second = digitsAt(text, 17, 2);
  if (hour < 0 || hour > 24 || text[13] !== ":" || minute < 0 || minute >= 60) return null;
  if (text[16] !== ":" || second < 0 || second >= 60) return null;
  if (hour === 24 && (minute !== 0 || second !== 0)) return null;

  let index = 19;
  let fraction = "0000000";
  if (text[index] === ".") {
    index += 1;
    const start = index;
    while (index < end && index - start < 7 && digitAt(text, index) >= 0) index += 1;
    if (index === start) return null;
    fraction = text.slice(start, index).padEnd(7, "0");
    if (hour === 24 && fraction !== "0000000") return null;
  }

  let kind: OldDateTime["kind"] = "unspecified";
  let offsetMinutes = 0;
  if (index < end) {
    const c = text[index];
    if (c === "Z" || c === "z") {
      kind = "utc";
      index += 1;
    } else {
      let sign = 0;
      let zoneHour = 0;
      if (index + 2 < end && digitsAt(text, index + 1, 2) >= 0 && (c === "+" || c === "-")) {
        sign = c === "+" ? 1 : -1;
        zoneHour = digitsAt(text, index + 1, 2);
        index += 3;
      }
      let zoneMinute = 0;
      if (index < end) {
        if (text[index] === ":") index += 1;
        if (index + 1 < end && digitsAt(text, index, 2) >= 0) {
          zoneMinute = digitsAt(text, index, 2);
          index += 2;
        }
      }
      if (sign !== 0) {
        kind = "local";
        offsetMinutes = sign * (zoneHour * 60 + zoneMinute);
      }
    }
  }
  if (index !== end) return null;

  const ms = epochMs(year, month, day, hour, minute, second) - offsetMinutes * 60_000;
  if (ms < MIN_MS || ms > MAX_MS) return null;
  return { ms, fraction, kind };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** `yyyy-MM-ddTHH:mm:ss` and the fraction without trailing zeros. */
function isoWall(date: OldDateTime): string {
  const at = new Date(date.ms);
  const fraction = date.fraction.replace(/0+$/, "");
  return (
    `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}` +
    `T${pad(at.getUTCHours(), 2)}:${pad(at.getUTCMinutes(), 2)}:${pad(at.getUTCSeconds(), 2)}` +
    (fraction === "" ? "" : `.${fraction}`)
  );
}

/** A date as the old serializer wrote it: `Z` for UTC, the server's offset for local, none else. */
function oldIso(date: OldDateTime): string {
  const suffix = date.kind === "utc" ? "Z" : date.kind === "local" ? "+00:00" : "";
  return `${isoWall(date)}${suffix}`;
}

/** A date as the platform's invariant text: `MM/dd/yyyy HH:mm:ss`, the fraction dropped. */
function oldInvariant(date: OldDateTime): string {
  const at = new Date(date.ms);
  return (
    `${pad(at.getUTCMonth() + 1, 2)}/${pad(at.getUTCDate(), 2)}/${pad(at.getUTCFullYear(), 4)} ` +
    `${pad(at.getUTCHours(), 2)}:${pad(at.getUTCMinutes(), 2)}:${pad(at.getUTCSeconds(), 2)}`
  );
}

/** A string value as the old serializer wrote it back: a date-like one in its own date form. */
export function oldStringText(text: string): string {
  const date = parseOldDate(text);
  return date === null ? text : oldIso(date);
}

const rawJson = (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON;

/**
 * A value parsed by {@link parseStudioJson}, written as the old serializer wrote stored answers:
 * numbers as {@link oldNumberText}, date-like strings as dates; property names as they are.
 */
export function oldJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, inner: unknown) => {
    if (inner instanceof JsonNumber) return rawJson(oldNumberText(inner.text));
    if (typeof inner === "string") return oldStringText(inner);
    return inner;
  });
}

/** The text with at most 7 fractional digits after its seconds (a scan). */
function withSevenFractionDigits(text: string): string {
  if (text[19] !== ".") return text;
  let end = 20;
  while (end < text.length && digitAt(text, end) >= 0) end += 1;
  return end - 20 <= 7 ? text : text.slice(0, 27) + text.slice(end);
}

/**
 * A time from Studio (RFC 3339) as the old results wrote their times: in UTC, up to 7 fractional
 * digits with trailing zeros dropped, with `Z` when `utc` (`HappendAt`) and without it otherwise
 * (`FirstResultAt`, `LastResultAt`); no time is the platform's minimum, `0001-01-01T00:00:00`.
 */
export function oldTime(timestamp: string | null, utc: boolean): string {
  if (timestamp === null) return "0001-01-01T00:00:00";
  const date = parseOldDate(withSevenFractionDigits(timestamp));
  if (date === null) throw new Error("Studio sent a time the bridge cannot read");
  return `${isoWall(date)}${utc ? "Z" : ""}`;
}

const LIST_TEXT = "System.Collections.Generic.List`1[System.Object]";
const DICTIONARY_TEXT = "System.Collections.Generic.Dictionary`2[System.String,System.Object]";

/** A `QuestionResult` key: its text, and what the old dictionary compared it by (`undefined`: nothing). */
interface OldKey {
  text: string;
  identity: string | undefined;
}

function scalarKey(value: string | boolean | JsonNumber): OldKey {
  if (typeof value === "boolean") {
    const text = value ? "True" : "False";
    return { text, identity: `b${text}` };
  }
  if (value instanceof JsonNumber) {
    if (value.isFloat) {
      const text = dotnetDouble(Number(value.text));
      return { text, identity: `f${text}` };
    }
    const text = value.text === "-0" ? "0" : value.text;
    return { text, identity: `i${text}` };
  }
  const date = parseOldDate(value);
  if (date !== null) {
    // Dates compared by their instant, whatever their kind.
    return { text: oldInvariant(date), identity: `d${date.ms}.${date.fraction}` };
  }
  return { text: value, identity: `s${value}` };
}

/**
 * The old key of an object's property: `[name, value]`. A list or object value shows as its type
 * name and, compared by reference, never equals another; other values compare by value.
 */
function pairKey(name: string, value: unknown): OldKey {
  if (Array.isArray(value)) return { text: `[${name}, ${LIST_TEXT}]`, identity: undefined };
  if (value === null || value === undefined) {
    return { text: `[${name}, ]`, identity: `p${name.length}:${name}n` };
  }
  if (typeof value === "object" && !(value instanceof JsonNumber)) {
    return { text: `[${name}, ${DICTIONARY_TEXT}]`, identity: undefined };
  }
  const inner = scalarKey(value as string | boolean | JsonNumber);
  return { text: `[${name}, ${inner.text}]`, identity: `p${name.length}:${name}${inner.identity}` };
}

/** Studio's count of an object answer's property: a `[name, value]` array. */
function isPair(value: unknown): value is [string, unknown] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

/**
 * Studio's `getQuestionSummary` values (parsed by {@link parseStudioJson}) as the old
 * `QuestionResult` entries, in order, a key possibly more than once (the old dictionary was keyed
 * by value, so `1` and `"1"` stayed apart under the same text). As the old aggregation: `null` is
 * skipped; Studio's `[name, value]` pairs are the old key/value pairs; a nested list is walked
 * into its elements and an object (an array's element) into its pairs; values the old dictionary
 * held as equal are merged.
 */
export function questionResultEntries(
  values: readonly { value: unknown; count: number | JsonNumber }[],
): [string, number][] {
  const entries: [string, number][] = [];
  const indexByIdentity = new Map<string, number>();
  const add = (key: OldKey, count: number): void => {
    if (key.identity === undefined) {
      for (let n = 0; n < count; n += 1) entries.push([key.text, 1]);
      return;
    }
    const index = indexByIdentity.get(key.identity);
    if (index === undefined) {
      indexByIdentity.set(key.identity, entries.length);
      entries.push([key.text, count]);
    } else {
      entries[index]![1] += count;
    }
  };

  for (const item of values) {
    const { value } = item;
    const count = item.count instanceof JsonNumber ? Number(item.count.text) : item.count;
    if (!Number.isSafeInteger(count) || count < 1)
      throw new Error("Studio sent a count that is no count");
    if (isPair(value)) {
      add(pairKey(value[0], value[1]), count);
      continue;
    }
    // A walk without recursion, so a deeply nested answer cannot exhaust the stack.
    const pending: unknown[] = [value];
    while (pending.length > 0) {
      const next = pending.pop();
      if (next === null || next === undefined) continue;
      if (Array.isArray(next)) {
        for (let index = next.length - 1; index >= 0; index -= 1) pending.push(next[index]);
      } else if (
        next instanceof JsonNumber ||
        typeof next === "string" ||
        typeof next === "boolean"
      ) {
        add(scalarKey(next), count);
      } else if (typeof next === "object") {
        for (const [name, inner] of Object.entries(next)) add(pairKey(name, inner), count);
      }
    }
  }
  return entries;
}

// `from`/`till` as the old API parsed them (the forms callers send): `yyyy-M-d` or `yyyy/M/d` or
// `M/d/yyyy`, an optional time `H:mm[:ss[.fffffff]]` after `T` or spaces, and an optional `Z` or
// offset. Unambiguous: each repetition is followed by something it cannot match.
const DATE_ARGUMENT =
  /^(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?$/i;

/**
 * A `from` or `till` value as RFC 3339 in UTC for Studio: a time without an offset is taken as
 * UTC, one with an offset is converted. `undefined` when the old API could not parse it either
 * (it then applied no bound), or in a form the bridge does not read.
 */
export function parseDateArgument(text: string): string | undefined {
  const match = DATE_ARGUMENT.exec(text.trim());
  if (match === null) return undefined;
  const [, y1, m1, d1, m2, d2, y2, h = "0", mi = "0", s = "0", fraction = ""] = match;
  const [sign, zoneHour = "0", zoneMinute = "0"] = match.slice(12);
  const year = Number(y1 ?? y2);
  const month = Number(m1 ?? m2);
  const day = Number(d1 ?? d2);
  const [hour, minute, second] = [Number(h), Number(mi), Number(s)];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const offset =
    sign === undefined ? 0 : (sign === "+" ? 1 : -1) * (Number(zoneHour) * 60 + Number(zoneMinute));
  const ms = epochMs(year, month, day, hour, minute, second) - offset * 60_000;
  if (ms < MIN_MS || ms > MAX_MS) return undefined;
  const digits = fraction.slice(0, 7);
  const wall = isoWall({ ms, fraction: "0000000", kind: "utc" });
  return `${wall}${digits === "" ? "" : `.${digits}`}Z`;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ATTRIBUTE_CHAR = /^[!#$&+\-.^_`|~0-9A-Za-z]$/;

/**
 * The old download header for a file name: `attachment; filename=<name>; filename*=UTF-8''<name>`.
 * The plain name has non-ASCII characters replaced by `_` and is quoted when it is not a token;
 * the extended one percent-encodes the UTF-8 bytes of anything but attribute characters.
 */
export function contentDisposition(name: string): string {
  // eslint-disable-next-line no-control-regex -- everything above ASCII
  const plain = name.replace(/[^\u0000-\u007f]/g, "_");
  const filename = TOKEN.test(plain) ? plain : `"${plain.replace(/["\\]/g, "\\$&")}"`;
  const encoded: string[] = ["UTF-8''"];
  for (const byte of Buffer.from(name, "utf8")) {
    const c = String.fromCharCode(byte);
    encoded.push(
      byte < 0x80 && ATTRIBUTE_CHAR.test(c)
        ? c
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    );
  }
  return `attachment; filename=${filename}; filename*=${encoded.join("")}`;
}
