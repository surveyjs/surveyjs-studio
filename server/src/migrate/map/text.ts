import type { Report } from "./report.js";

/** One leading byte-order mark removed (N6). */
export const withoutBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

const NUL = "\u0000";
const REPLACEMENT = "\uFFFD";

/**
 * A parsed JSON value with every U+0000 inside a string (or a property name) replaced by U+FFFD,
 * as `jsonText` does for PostgreSQL; the same on both dialects. Reports `nul_replaced` by `ids`
 * once when it replaced any. The value is returned as it is when it holds none.
 */
export function withoutNul<T>(value: T, ids: Record<string, string>, report: Report): T {
  let found = false;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (!node.includes("\u0000")) return node;
      found = true;
      return node.replaceAll(NUL, REPLACEMENT);
    }
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === "object" && node !== null) {
      const copy: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(node)) {
        if (key.includes("\u0000")) found = true;
        Object.defineProperty(copy, key.replaceAll(NUL, REPLACEMENT), {
          value: walk(inner),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return copy;
    }
    return node;
  };
  const result = walk(value) as T;
  if (!found) return value;
  report.note("nul_replaced", ids);
  return result;
}

/** The JSON object in `text` after the BOM; null when it is not JSON or not an object. */
export function objectOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(withoutBom(text));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
