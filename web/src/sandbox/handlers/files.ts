// Mirrors server/src/files/ (handlers.ts, service.ts, quota.ts, file-type.ts) and
// server/src/domain/file-id.ts: editor uploads, respondent uploads and public downloads. Bytes are
// kept as base64 in the stored document (D5), so a file counts towards `storageLimitKb` at its
// base64 size. The type is decided by the file name's extension only (the spec: no file-type
// detection beyond the extension). The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxData, SandboxFile } from "../store";
import { mutate, requireSession, view } from "./common";
import { newFileId, type HandlerContext } from "./context";
import { http } from "./http";
import { readFirstFile } from "./multipart";
import { guarded, notFound, ProblemError, surveyNotAvailable, validationFailed } from "./problems";
import { modifiableSurvey } from "./surveys";

/** The field an upload sends its file in. */
const FILE_FIELD = "file";

const KB = 1024;
const MB = 1024 * 1024;
const oneDecimal = (value: number): string => String(Math.round(value * 10) / 10);

/** A size for people (quota.ts `formatBytes`): `50 MB`, `1.5 MB`, `64 KB`, `500 bytes`. */
function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${oneDecimal(bytes / MB)} MB`;
  if (bytes >= KB) return `${oneDecimal(bytes / KB)} KB`;
  return `${bytes} bytes`;
}

const ALLOWED_TYPES_TEXT =
  "Upload a PNG, JPEG, GIF, WebP, AVIF, BMP or SVG image, or an MP4, WebM or Ogg video.";

/** The allowed types by extension (file-type.ts lists the same types, there by content). */
const TYPE_OF_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg",
};

function typeOfName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (TYPE_OF_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null);
}

/** The stored name (file-type.ts `fileNameOf`): no folder part, no control characters, 1 to 255 units. */
function fileNameOf(raw: string | undefined): string {
  const base = (raw ?? "").split(/[/\\]/).pop() ?? "";
  const printable = [...base.replace(/\p{Surrogate}/gu, "\ufffd")]
    .filter((char) => char >= " " && char !== "\u007f")
    .join("")
    .trim();
  let name = "";
  for (const char of printable) {
    if (name.length + char.length > 255) break;
    name += char;
  }
  name = name.trimEnd();
  return name === "" ? "file" : name;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition` of a download (file-type.ts): `inline` for images, else `attachment`. */
function contentDisposition(file: { contentType: string; name: string }): string {
  const kind = file.contentType.startsWith("image/") ? "inline" : "attachment";
  const ascii = file.name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(file.name)}`;
}

// The values of server/src/files/handlers.ts.
const CACHE_CONTROL = "public, max-age=3600";
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

const quotaExceeded = (quota: number) =>
  new ProblemError({
    code: "quota-exceeded",
    status: 413,
    title: "File quota exceeded",
    detail: `This survey can store up to ${formatBytes(quota)} of files.`,
  });

const fileTooLarge = (max: number) =>
  new ProblemError({
    code: "payload-too-large",
    status: 413,
    title: "File too large",
    detail: `A file can be up to ${formatBytes(max)}.`,
  });

const invalidFile = (detail: string) => validationFailed([{ pointer: `/${FILE_FIELD}`, detail }]);

// ---------------------------------------------------------------- bytes (no `Buffer` in a browser)

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

// ---------------------------------------------------------------- handlers

const created = (file: SandboxFile, origin: string): Response =>
  HttpResponse.json(
    {
      id: file.id,
      url: `${origin}/api/v1/public/files/${file.id}`,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
    },
    { status: 201, headers: { Location: `/api/v1/public/files/${file.id}` } },
  );

/** Bytes of assets the survey holds. */
const assetBytes = (data: SandboxData, surveyId: string): number =>
  data.files
    .filter((file) => file.surveyId === surveyId && (file.kind ?? "asset") === "asset")
    .reduce((sum, file) => sum + file.size, 0);

/**
 * The first file part, which must be in the field `file` (else 422); over `refuseAbove` bytes is
 * `tooLarge()` (a part in another field is refused before any size check, as on the server).
 */
async function incomingFile(
  request: Request,
  refuseAbove: () => number,
  tooLarge: () => ProblemError,
) {
  const part = await readFirstFile(request);
  if (part?.fieldName !== FILE_FIELD) throw invalidFile("Send one file in the part named file.");
  if (part.bytes.length > refuseAbove()) throw tooLarge();
  if (part.bytes.length === 0) throw invalidFile("The file is empty.");
  return part;
}

export function fileHandlers(ctx: HandlerContext) {
  // The settings decide both limits: the config answer advertises the same numbers.
  const quota = ctx.settings.maxUploadKb * KB;
  const maxFileBytes = ctx.settings.maxUploadKb * KB;

  return [
    // R13 order: sign-in, survey (404, 403), quota used up, the file, its type.
    http.post("/surveys/{surveyId}/assets", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const left = (data: SandboxData, surveyId: string) => quota - assetBytes(data, surveyId);
        const surveyId = view(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          if (left(data, survey.id) <= 0) throw quotaExceeded(quota);
          return survey.id;
        });
        // A file larger than what is left of the quota is the quota (the server's read limit).
        const part = await incomingFile(
          request,
          () => left(ctx.store.read(), surveyId),
          () => quotaExceeded(quota),
        );
        const name = fileNameOf(part.fileName);
        const contentType = typeOfName(name);
        if (contentType === null) {
          throw new ProblemError({
            code: "unsupported-media-type",
            status: 415,
            title: "Unsupported file type",
            detail: ALLOWED_TYPES_TEXT,
          });
        }
        const base64 = toBase64(part.bytes);
        const file = mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          // Checked again at the write: an upload in another tab may have used the quota.
          if (part.bytes.length > left(data, survey.id)) throw quotaExceeded(quota);
          const stored: SandboxFile = {
            id: newFileId(survey.id),
            surveyId: survey.id.toLowerCase(),
            kind: "asset",
            name,
            contentType,
            size: part.bytes.length,
            base64,
            createdAt: ctx.now().toISOString(),
          };
          data.files.push(stored);
          return stored;
        });
        return created(file, ctx.origin);
      }),
    ),

    // S11 order: the survey must be available, then the file; any type is stored.
    http.post("/public/surveys/{surveyId}/files", ({ params, request }) =>
      guarded(async () => {
        const available = (data: SandboxData) => {
          const survey = data.surveys.find((s) => s.id === params.surveyId.toLowerCase());
          if (!survey?.published) throw surveyNotAvailable();
          return survey;
        };
        available(ctx.store.read());
        const part = await incomingFile(
          request,
          () => maxFileBytes,
          () => fileTooLarge(maxFileBytes),
        );
        const name = fileNameOf(part.fileName);
        const contentType = typeOfName(name) ?? "application/octet-stream";
        const base64 = toBase64(part.bytes);
        let stored!: SandboxFile;
        // Checked again at the write: a survey unpublished or deleted meanwhile keeps no file.
        ctx.store.write((data) => {
          const survey = available(data);
          stored = {
            id: newFileId(survey.id),
            surveyId: survey.id,
            kind: "respondent",
            name,
            contentType,
            size: part.bytes.length,
            base64,
            createdAt: ctx.now().toISOString(),
          };
          data.files.push(stored);
        });
        return created(stored, ctx.origin);
      }),
    ),

    http.get("/public/files/{fileId}", ({ params }) =>
      guarded(() => {
        const id = params.fileId.toLowerCase();
        const file = ctx.store.read().files.find((candidate) => candidate.id === id);
        if (!file) throw notFound();
        return new HttpResponse(fromBase64(file.base64), {
          status: 200,
          headers: {
            "Content-Type": file.contentType,
            "Content-Length": String(file.size),
            "Content-Disposition": contentDisposition(file),
            "Cache-Control": CACHE_CONTROL,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": CONTENT_SECURITY_POLICY,
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }),
    ),
  ];
}
