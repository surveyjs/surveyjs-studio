import { AppError } from "../errors.js";

export type ExportFormat = "json" | "csv";

/** Media ranges an export answers (R2); the most specific ones and the wildcards. */
const FORMATS = new Map<string, ExportFormat>([
  ["application/json", "json"],
  ["application/*", "json"],
  ["*/*", "json"],
  ["text/csv", "csv"],
  ["text/*", "csv"],
]);

/**
 * The export's format (R2): `format` when given; else the first range of `Accept` this endpoint
 * serves, highest q-value first (ties keep the header's order; `q=0` and unreadable q-values are
 * ignored); JSON without an `Accept`; null when `Accept` names neither (406).
 */
export function negotiateExportFormat(
  format: ExportFormat | undefined,
  accept: string | undefined,
): ExportFormat | null {
  if (format !== undefined) return format;
  if (accept === undefined || accept.trim() === "") return "json";
  const ranges = accept
    .split(",")
    .map((part, index) => {
      const [range = "", ...params] = part.split(";").map((piece) => piece.trim().toLowerCase());
      const q = params.find((param) => param.startsWith("q="));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { range, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ quality }) => quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { range } of ranges) {
    const found = FORMATS.get(range);
    if (found) return found;
  }
  return null;
}

/**
 * The download's file name (R6): the survey name and the format's extension, `results` for a blank
 * name. Control characters are dropped and lone surrogates become U+FFFD (the RFC 5987 encoding
 * cannot encode them).
 */
export function exportFileName(surveyName: string, format: ExportFormat): string {
  const name = surveyName
    .replace(/\p{Surrogate}/gu, "�")
    .replace(/\p{Cc}/gu, "")
    .trim();
  return `${name === "" ? "results" : name}.${format}`;
}

export function notAcceptable(): AppError {
  return new AppError({
    code: "not-acceptable",
    status: 406,
    title: "Not acceptable",
    detail: "Ask for application/json or text/csv, or use format=json or format=csv.",
  });
}
