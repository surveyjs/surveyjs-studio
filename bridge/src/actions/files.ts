// The old API's file reads (reference behaviour: ADR 0039 point 3): `image` and `file` serve a
// file a respondent uploaded, `files?name=` an image placed in the editor. A name the bridge's
// `upload` answered (a Studio file ID with its extension, with or without the `dxsimage:` or
// `dxsfile:` prefix) reads through Studio's `downloadFile`; any other through `getLegacyFile`.
// The bytes stream through as Studio sends them, within `BRIDGE_FILE_TIMEOUT_MS`.
import { validateHeaderValue } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendEmpty, sendProblem } from "../answers.js";
import { EMPTY_GUID } from "../binding.js";
import { contentDisposition } from "../dotnet-format.js";
import { oldRoute, queryValue } from "../routes.js";
import { unexpectedStatus } from "../studio.js";

const STUDIO_FILE_ID = /^[0-9a-f]{64}$/;
const UPLOAD_PREFIXES = ["dxsimage:", "dxsfile:"] as const;

/** Studio's rule for legacy names (one path segment, not only dots, at most 100 characters). */
const LEGACY_NAME = /^[A-Za-z0-9._-]+$/;
const MAX_LEGACY_NAME_LENGTH = 100;

/** What a file name read by the old actions names. */
type Target =
  /** A file stored by the bridge's `upload`; `name` is the name without the upload prefix. */
  | { fileId: string; name: string }
  /** A name the old store held. */
  | { legacyName: string }
  /** A name the old store refused to look up (a colon): its unhandled error. */
  | "refused"
  /** A name no file can have (a path, a dot segment, a space…): the old answer for no file. */
  | "unknown";

/** An extension after a Studio file ID: the legacy names' characters, no further dot. */
const EXTENSION = /^\.[A-Za-z0-9_-]*$/;

/**
 * The Studio file a name answered by `upload` names: 64 hex digits, then the original extension.
 * `"refused"` when the extension has any other character (it would reach a response header);
 * `undefined` when the name is no such name.
 */
function studioFile(name: string): { fileId: string; name: string } | "refused" | undefined {
  const prefix = UPLOAD_PREFIXES.find((candidate) => name.startsWith(candidate));
  const rest = prefix === undefined ? name : name.slice(prefix.length);
  const fileId = rest.slice(0, 64);
  const extension = rest.slice(64);
  if (!STUDIO_FILE_ID.test(fileId)) return undefined;
  if (extension === "" || EXTENSION.test(extension)) return { fileId, name: rest };
  return extension.startsWith(".") ? "refused" : undefined;
}

/**
 * What `name` names. Only respondent files (`image`, `file`) can be Studio files: editor images
 * (`files?name=`) are all legacy, and some legacy names are 64 hex digits too.
 */
function target(name: string, uploads: boolean): Target {
  const file = uploads ? studioFile(name) : undefined;
  if (file !== undefined) return file;
  if (name.includes(":")) return "refused";
  if (name.length > MAX_LEGACY_NAME_LENGTH || !LEGACY_NAME.test(name) || /^\.+$/.test(name)) {
    return "unknown";
  }
  return { legacyName: name };
}

/** Studio's headers that keep a served file from running as a page; the old API sent none. */
const SAFETY_HEADERS = [
  "x-content-type-options",
  "content-security-policy",
  "cross-origin-resource-policy",
] as const;

/**
 * Streams the file `found` names to the caller with `headers` (given Studio's answer), or answers
 * `false` when Studio has no such file. Nothing is sent before Studio's headers have come.
 */
async function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  found: { fileId: string } | { legacyName: string; kind: "asset" | "response" },
  headers: (studio: Response) => Record<string, string>,
): Promise<FastifyReply | false> {
  const { data, response } =
    "fileId" in found
      ? await request.studioFiles.GET("/public/files/{fileId}", {
          params: { path: { fileId: found.fileId } },
          parseAs: "stream",
        })
      : await request.studioFiles.GET("/public/legacy-files/{kind}/{name}", {
          params: { path: { kind: found.kind, name: found.legacyName } },
          parseAs: "stream",
        });
  if (response.status === 404) return false;
  const body = data as WebReadableStream<Uint8Array> | null | undefined;
  if (response.status !== 200) {
    if (response.ok) await body?.cancel().catch(() => undefined);
    return unexpectedStatus(response);
  }
  let answer: Record<string, string>;
  // Checked before anything is written: a header Node refuses would otherwise fail the answer
  // once it has started, with the framework's own error text and Studio's stream left open.
  try {
    answer = headers(response);
    const length = response.headers.get("content-length");
    if (length !== null) answer["content-length"] = length;
    for (const [name, value] of Object.entries(answer)) validateHeaderValue(name, value);
  } catch (error) {
    request.log.warn({ err: error }, "a file's header cannot be sent");
    await body?.cancel().catch(() => undefined);
    return sendEmpty(reply, 500);
  }
  reply.code(200).headers(answer);
  // An empty file comes without a body.
  if (body === undefined || body === null) return reply.send(Buffer.alloc(0));
  return reply.send(Readable.fromWeb(body));
}

/** `image` and `file`: a respondent's file by `filePath`. */
async function respondentFile(
  request: FastifyRequest,
  reply: FastifyReply,
  as: "image" | "file",
): Promise<FastifyReply> {
  const filePath = queryValue(request, "filePath");
  // A missing or empty name, or one the old store refused, failed unhandled.
  if (filePath === undefined || filePath === "") return sendEmpty(reply, 500);
  const named = target(filePath, true);
  if (named === "refused") return sendEmpty(reply, 500);
  if (named === "unknown") return sendProblem(reply, 404);
  const found = "fileId" in named ? named : { ...named, kind: "response" as const };
  const sent = await sendFile(request, reply, found, (studio) => {
    if (as === "file") {
      const name = "fileId" in named ? named.name : named.legacyName;
      return {
        "content-type": "application/octet-stream",
        "content-disposition": contentDisposition(name),
      };
    }
    // Inline with the stored type, as the old API sent images.
    const headers: Record<string, string> = {
      "content-type": studio.headers.get("content-type") ?? "application/octet-stream",
    };
    for (const name of SAFETY_HEADERS) {
      const value = studio.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return headers;
  });
  return sent === false ? sendProblem(reply, 404) : sent;
}

export function registerFileActions(app: FastifyInstance): void {
  oldRoute(app, ["GET"], ["image"], (request, reply) => respondentFile(request, reply, "image"));
  oldRoute(app, ["GET"], ["file"], (request, reply) => respondentFile(request, reply, "file"));

  oldRoute(
    app,
    ["GET"],
    ["files"],
    async (request, reply) => {
      const name = queryValue(request, "name");
      // No name, the logo's name (its file was never deployed) and a name the old store refused
      // all failed, which the private actions answered with an empty 400.
      if (name === undefined || name === "" || name === EMPTY_GUID) return sendEmpty(reply, 400);
      const named = target(name, false);
      if (named === "refused") return sendEmpty(reply, 400);
      // A path or any name no legacy file has (Review Focus 4): no lookup at all.
      if (named === "unknown" || !("legacyName" in named)) return sendEmpty(reply, 404);
      const sent = await sendFile(
        request,
        reply,
        { legacyName: named.legacyName, kind: "asset" },
        () => ({
          "content-type": "application/octet-stream",
          "content-disposition": contentDisposition(name),
        }),
      );
      return sent === false ? sendEmpty(reply, 404) : sent;
    },
    { controller: "private" },
  );
}
