import { createHash } from "node:crypto";
import type { FileKind, SurveyFileRecord } from "./types.js";

/**
 * Files stored under the old service's names (ADR 0039 point 3): editor images (`asset`) and
 * respondent uploads (`response`), which sites still reference by name.
 */

/** Letters, digits, `.`, `-` and `_`: one path segment, matched as stored (case included). */
const LEGACY_NAME = /^[A-Za-z0-9._-]+$/;
/**
 * The longest legacy name taken: longer than any name the old service made (a GUID with an
 * extension, or its 68-character preview image names).
 */
const MAX_LEGACY_NAME_LENGTH = 100;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/**
 * Whether `name` can be a legacy file name. Anything else (a path, `.` or `..`, a space, a
 * `dxsimage:` prefix) is unknown without a lookup.
 */
export function isLegacyFileName(name: string): boolean {
  return name.length <= MAX_LEGACY_NAME_LENGTH && LEGACY_NAME.test(name) && !/^\.+$/.test(name);
}

/**
 * Content types by extension, as the old service served them (the platform's extension table);
 * types a browser would run as a page or script (HTML, JavaScript) are left out on purpose.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  avi: "video/x-msvideo",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "video/ogg",
  wav: "audio/wav",
  webm: "video/webm",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "text/xml",
  zip: "application/x-zip-compressed",
};

/** The type of a legacy file from its name's extension (any case); `application/octet-stream` otherwise. */
export function legacyContentType(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, extension)
    ? CONTENT_TYPES[extension]!
    : "application/octet-stream";
}

/**
 * The record of a legacy file a provider holds by name only (memory, the legacy shares, the SQL
 * seed): its id is 32 zeros and 32 hex digits of the SHA-256 of `{kind}/{name}`, so it belongs to
 * the all-zero survey, which no survey has; created at the epoch (the time is not known).
 */
export function legacyFileRecord(kind: FileKind, name: string, size: number): SurveyFileRecord {
  const hash = createHash("sha256").update(`${kind}/${name}`).digest("hex");
  return {
    id: `${"0".repeat(32)}${hash.slice(0, 32)}`,
    surveyId: ZERO_GUID,
    kind,
    name,
    contentType: legacyContentType(name),
    size,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}
