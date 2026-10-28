import type { SqlDialectName } from "./database.js";

/** Reading and writing column values that differ by dialect (see schema.ts). */

/** A timestamp column as Date#toISOString writes it. */
export const isoOf = (value: Date | string): string => new Date(value).toISOString();

/** A boolean column (SQLite gives 0 or 1). */
export const flagOf = (value: boolean | number): boolean => value === true || value === 1;

/** A JSON column: PostgreSQL's driver parses jsonb, SQLite gives the text. */
export const jsonOf = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

/** U+FFFD, the replacement character. */
const REPLACEMENT = String.fromCharCode(0xfffd);

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** The text with U+0000 and every surrogate without its pair as U+FFFD. */
function forJsonbText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (isHigh(unit) && isLow(text.charCodeAt(i + 1))) {
      out += text.slice(i, i + 2);
      i++;
    } else if (unit === 0 || isHigh(unit) || isLow(unit)) {
      out += REPLACEMENT;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** A JSON value with every string and key as jsonb can hold it. */
function forJsonb(value: unknown): unknown {
  if (typeof value === "string") return forJsonbText(value);
  if (Array.isArray(value)) return value.map(forJsonb);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [forJsonbText(key), forJsonb(item)]),
    );
  }
  return value;
}

/**
 * The JSON text a JSON column is written with. PostgreSQL's jsonb holds neither U+0000 nor a lone
 * surrogate (a client that cuts text inside an emoji sends one) and refuses the whole value, so
 * there each is written as U+FFFD; SQLite keeps the text exactly.
 */
export const jsonText = (dialect: SqlDialectName, value: unknown): string =>
  JSON.stringify(dialect === "postgres" ? forJsonb(value) : value);
