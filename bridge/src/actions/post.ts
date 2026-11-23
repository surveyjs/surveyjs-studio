// The old API's writes (reference behaviour: ADR 0039): `post` through Studio's
// `submitResponseByPostId` and `upload` through `uploadResponseFileByPostId`. Neither sends an
// `Idempotency-Key`: a repeated old post stores a second response, as before.
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendEmpty, sendJsonString, sendProblem, sendValidationProblem } from "../answers.js";
import { EMPTY_GUID, parseGuid } from "../binding.js";
import { contextOf, type ActionContext } from "../context.js";
import { bindJsonBody, parseLenientJson } from "../json-body.js";
import { unexpectedStatus } from "../studio.js";

const POST_BODY = {
  postId: "guid",
  surveyResult: "string",
  clientId: "string",
  isPartialCompleted: "boolean",
} as const;

/**
 * The old API's answer when its storage refused a post, `message\ncode: message`. The old text
 * also carried the storage's request ID and time, so it was never byte-stable.
 */
function storageRefusal(code: string, message: string): string {
  return `${message}\n${code}: ${message}`;
}

const TOO_LARGE = storageRefusal(
  "PropertyValueTooLarge",
  "The property value exceeds the maximum allowed size (64KB). If the property value is a string, it is UTF-16 encoded and the maximum number of characters should be 32K or less.",
);
const INVALID_INPUT = storageRefusal("InvalidInput", "One of the request inputs is not valid.");

/** The media type of the request, lower-case, without parameters; `""` without one. */
function mediaType(request: FastifyRequest): string {
  return (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

/** The JSON types the old API read a body as: `application/json`, `text/json`, `application/*+json`. */
function isJson(type: string): boolean {
  return (
    type === "application/json" || type === "text/json" || /^application\/[^/]+\+json$/.test(type)
  );
}

/** The body bytes the action routes' parser collected; empty without a body. */
function bodyBytes(request: FastifyRequest): Buffer {
  return Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
}

/** The largest `post` body (bytes): far above any answer set Studio stores; larger is an empty 413. */
export const MAX_POST_BYTES = 4 * 1024 * 1024;

/**
 * The answers in `surveyResult`, read as the old API's readers read stored answers (its lenient
 * JSON); `undefined` when they are not a JSON object.
 */
function answersOf(surveyResult: string): Record<string, unknown> | undefined {
  const parsed = parseLenientJson(surveyResult);
  const value = parsed?.value;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `Path.GetExtension` of the old API: from the last dot of the last segment, `""` when it ends the name. */
function extensionOf(fileName: string): string {
  const name = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 || dot === name.length - 1 ? "" : name.slice(dot);
}

/** An extension `image` and `file` accept after a Studio file ID (actions/files.ts). */
const READABLE_EXTENSION = /^\.[A-Za-z0-9_-]+$/;

const IMAGE_EXTENSIONS = new Set(["jpeg", "jpg", "png", "bmp", "svg", "gif"]);

/**
 * How many `upload` requests the bridge reads at once; one more is refused before its body is read
 * with an empty `503`, as the old host answered when overloaded. Each holds its body in memory (up
 * to `BRIDGE_MAX_UPLOAD_BYTES`) and then the form parsed from it.
 */
export const MAX_CONCURRENT_UPLOADS = 8;

/** Uploads being read, per bridge. */
const uploads = new WeakMap<ActionContext, number>();

/** `post`: one response, through `submitResponseByPostId`. */
export async function post(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  if (!isJson(mediaType(request))) return sendProblem(reply, 415);
  const bytes = bodyBytes(request);
  if (bytes.length === 0) {
    return sendValidationProblem(reply, { "": ["A non-empty request body is required."] });
  }
  const { model, errors } = bindJsonBody(new TextDecoder().decode(bytes), POST_BODY);
  if (Object.keys(errors).length > 0) return sendValidationProblem(reply, errors);
  if (model === null) {
    return sendValidationProblem(reply, { "": ["A non-empty request body is required."] });
  }

  const { postId = EMPTY_GUID, surveyResult, clientId, isPartialCompleted } = model;
  if (surveyResult === undefined || surveyResult === null || surveyResult === "") {
    return sendProblem(reply, 400);
  }
  if (postId === EMPTY_GUID) return sendJsonString(reply, 400, "Check parameter values.");
  // The old API stored any text; its readers skipped what was not a JSON object. Nothing is
  // stored here, so no marker is set, and an unknown post ID answers 200 too.
  const data = answersOf(surveyResult);
  if (data === undefined) {
    request.log.warn({ postId }, "post: surveyResult is not a JSON object; nothing stored");
    return sendEmpty(reply, 200);
  }

  const withClient = clientId !== undefined && clientId !== null && clientId !== "";
  const { response } = await request.studio.POST("/public/posts/{postId}/responses", {
    params: { path: { postId } },
    body: {
      data,
      ...(withClient && { clientId }),
      // Partial only with a client ID, as the old API stored it.
      partial: withClient && isPartialCompleted === true,
    },
  });
  switch (response.status) {
    case 201:
      return sendEmpty(reply, 200);
    case 404:
      return sendJsonString(reply, 400, "Check parameter values.");
    case 413:
      return sendJsonString(reply, 400, TOO_LARGE);
    case 400:
    case 422:
      return sendJsonString(reply, 400, INVALID_INPUT);
    default:
      return unexpectedStatus(response);
  }
}

/** `upload`: one respondent file, through `uploadResponseFileByPostId`. */
export async function upload(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const type = mediaType(request);
  if (type !== "multipart/form-data" && type !== "application/x-www-form-urlencoded") {
    return sendProblem(reply, 415);
  }
  let form: FormData;
  try {
    // A view of the body's bytes, not a copy.
    const bytes = bodyBytes(request);
    const view = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length);
    form = await new Response(view, {
      headers: { "content-type": request.headers["content-type"]! },
    }).formData();
  } catch (error) {
    request.log.info({ err: error }, "unreadable form");
    return sendEmpty(reply, 500);
  }
  // The first file part of any field name; a part with an empty file name is not a file.
  let file: File | undefined;
  let postIdField: string | undefined;
  for (const [name, value] of form) {
    if (file === undefined && typeof value !== "string" && value.name !== "") file = value;
    if (postIdField === undefined && name.toLowerCase() === "postid" && typeof value === "string") {
      postIdField = value;
    }
  }
  if (file === undefined || postIdField === undefined) return sendProblem(reply, 415);
  const postId = parseGuid(postIdField);
  if (postId === null) return sendProblem(reply, 404);

  const upload = new FormData();
  upload.append("file", file, file.name);
  const { data, response } = await request.studio.POST("/public/posts/{postId}/files", {
    params: { path: { postId } },
    body: upload as unknown as { file: string },
    bodySerializer: (body) => body as unknown as FormData,
  });
  if (data !== undefined) {
    const extension = extensionOf(file.name);
    const kind = IMAGE_EXTENSIONS.has(extension.slice(1).toLowerCase()) ? "dxsimage" : "dxsfile";
    // The name must read back through `image` and `file`, which take only these characters
    // after the dot: any other extension is left out of the name (the file is stored as sent).
    const kept = READABLE_EXTENSION.test(extension) ? extension : "";
    return sendJsonString(reply, 200, `${kind}:${data.id}${kept}`);
  }
  switch (response.status) {
    case 404:
      return sendProblem(reply, 404);
    case 413:
      // The old host's own limit answered an empty 413.
      return sendEmpty(reply, 413);
    case 422:
      // An empty file, which Studio does not store: the old answer for no file.
      return sendProblem(reply, 415);
    default:
      return unexpectedStatus(response);
  }
}

/** The deadline timer of each `upload` whose body is being read. */
const readDeadlines = new WeakMap<FastifyRequest, NodeJS.Timeout>();

function stopReadDeadline(request: FastifyRequest): void {
  clearTimeout(readDeadlines.get(request));
  readDeadlines.delete(request);
}

/**
 * Before an `upload`'s body is read: refused while `MAX_CONCURRENT_UPLOADS` are being read, so a
 * refused upload is never buffered; one not read in full within `BRIDGE_UPLOAD_READ_TIMEOUT_MS` is
 * answered an empty `408` and its connection is closed, which frees its slot (the close handler).
 */
export async function uploadGate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const context = contextOf(request);
  const active = uploads.get(context) ?? 0;
  if (active >= MAX_CONCURRENT_UPLOADS) {
    request.log.warn("upload: too many uploads at once");
    // Close the connection: the body the caller is still sending is not read.
    return sendEmpty(reply.header("connection", "close"), 503);
  }
  uploads.set(context, active + 1);
  context.metrics.uploads.inc();
  const timer = setTimeout(() => {
    readDeadlines.delete(request);
    request.log.warn("upload: body not read in time");
    // Fastify's reply cannot be used: the body is still streaming. Answer on the socket, then
    // cut the connection once the answer is out.
    const raw = reply.raw;
    if (raw.headersSent || raw.writableEnded) return request.raw.destroy();
    raw.writeHead(408, { "Content-Length": "0", Connection: "close" });
    raw.end(() => request.raw.destroy());
  }, context.settings.uploadReadTimeoutMs);
  readDeadlines.set(request, timer);
  reply.raw.once("close", () => {
    stopReadDeadline(request);
    uploads.set(context, (uploads.get(context) ?? 1) - 1);
    context.metrics.uploads.dec();
  });
  return undefined;
}

/** After an `upload`'s body has been read in full: the deadline no longer applies. */
export async function uploadBodyRead(request: FastifyRequest): Promise<void> {
  stopReadDeadline(request);
}
