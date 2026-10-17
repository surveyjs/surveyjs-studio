import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { MULTIPART_LIMITS, type Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import { AppError } from "../errors.js";
import { contentDisposition } from "./file-type.js";
import {
  createFilesService,
  FILE_FIELD,
  filePath,
  fileTooLarge,
  quotaExceeded,
  type FilesServiceOptions,
  type IncomingFile,
} from "./service.js";

/** R7: a downloaded file may be cached for an hour; a deleted one disappears after that at the latest. */
const CACHE_CONTROL = "public, max-age=3600";
/** R7: an SVG opened directly runs no script and loads nothing. */
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

const unreadableBody = (cause: unknown): AppError =>
  new AppError({
    code: "bad-request",
    status: 400,
    title: "Bad request",
    detail: "The multipart body could not be read.",
    cause,
  });

/**
 * Reads the first file part of a multipart request, at most `maxBytes` of it; a file over it throws
 * `tooLarge()`. A part in another field is drained unread (the service refuses it with 422 before
 * any size check).
 */
async function readFirstFile(
  request: FastifyRequest,
  maxBytes: number,
  tooLarge: () => AppError,
): Promise<IncomingFile | undefined> {
  let part: MultipartFile;
  let bytes: Buffer;
  try {
    const first = await request.file({ limits: { ...MULTIPART_LIMITS, fileSize: maxBytes } });
    if (!first) return undefined;
    part = first;
    if (part.fieldname !== FILE_FIELD) {
      part.file.resume();
      return { fieldName: part.fieldname, fileName: part.filename, bytes: Buffer.alloc(0) };
    }
    bytes = await part.toBuffer();
  } catch (error) {
    const { code } = error as { code?: unknown };
    throw code === "FST_REQ_FILE_TOO_LARGE" ? tooLarge() : unreadableBody(error);
  }
  // toBuffer() misses the limit when the bytes over it arrive after it read the rest: it then
  // returns the first maxBytes bytes. The stream still says it was cut.
  if (part.file.truncated) throw tooLarge();
  return { fieldName: part.fieldname, fileName: part.filename, bytes };
}

/** The file operations: editor and respondent uploads, public downloads. */
export function createFileHandlers(options: FilesServiceOptions): Handlers {
  const service = createFilesService(options);
  const quota = options.maxAssetBytesPerSurvey;

  return {
    uploadSurveyAsset: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const stored = await service.uploadAsset(requireUser(request), surveyId, (maxBytes) =>
        readFirstFile(request, maxBytes, () => quotaExceeded(quota)),
      );
      return reply.code(201).header("location", filePath(stored.id)).send(stored);
    },

    uploadResponseFile: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const stored = await service.uploadResponse(surveyId, (maxBytes) =>
        readFirstFile(request, maxBytes, () => fileTooLarge(maxBytes)),
      );
      return reply.code(201).header("location", filePath(stored.id)).send(stored);
    },

    downloadFile: async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const { file, content } = await service.download(fileId);
      return reply
        .code(200)
        .headers({
          "content-type": file.contentType,
          "content-length": file.size,
          "content-disposition": contentDisposition(file),
          "cache-control": CACHE_CONTROL,
          "x-content-type-options": "nosniff",
          "content-security-policy": CONTENT_SECURITY_POLICY,
          "cross-origin-resource-policy": "cross-origin",
        })
        .send(content);
    },
  };
}
