/** Reading column values that differ by dialect (see schema.ts). */

/** A timestamp column as Date#toISOString writes it. */
export const isoOf = (value: Date | string): string => new Date(value).toISOString();

/** A boolean column (SQLite gives 0 or 1). */
export const flagOf = (value: boolean | number): boolean => value === true || value === 1;

/** A JSON column: PostgreSQL's driver parses jsonb, SQLite gives the text. */
export const jsonOf = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;
