// The Creator's file uploads (images, videos, the logo, theme backgrounds) go to the survey's
// assets. No Creator or React code here: `creatorSetup.ts` connects this to `onUploadFile`.
import { ApiError, type Problem } from "../api/client";
import type { StoredFile } from "../api/files";

const KB = 1024;
const MB = 1024 * 1024;

/** One decimal at most, without a trailing `.0`. */
const oneDecimal = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * A size for people: `50 MB`, `1.5 MB`, `64 KB`, `500 bytes`. The server words its quota problem
 * with the same rule (its own copy: the two are deployed separately).
 */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${oneDecimal(bytes / MB)} MB`;
  if (bytes >= KB) return `${oneDecimal(bytes / KB)} KB`;
  return `${bytes} bytes`;
}

const quotaMessage = (maxAssetBytesPerSurvey: number) =>
  `A survey can store up to ${formatBytes(maxAssetBytesPerSurvey)} of files in total. This file was not uploaded.`;

const messagesByCode: Readonly<Partial<Record<Problem["code"], string>>> = {
  "unsupported-media-type":
    "This file type cannot be uploaded. Use a PNG, JPEG, GIF, WebP, AVIF, BMP or SVG image, or an MP4, WebM or Ogg video.",
  forbidden: "You cannot change this survey. The file was not uploaded.",
  "not-found": "This survey is no longer available. The file was not uploaded.",
  unauthenticated: "Your session has ended. Sign in again, then upload the file again.",
};

const TRY_AGAIN = "The file was not uploaded. Please try again.";

/** What to tell the user when an upload failed with `error`. */
export function uploadErrorMessage(error: unknown, maxAssetBytesPerSurvey: number): string {
  if (!(error instanceof ApiError)) return TRY_AGAIN;
  const { code } = error.problem;
  if (code === "quota-exceeded") return quotaMessage(maxAssetBytesPerSurvey);
  return messagesByCode[code] ?? TRY_AGAIN;
}

/** Where the editor's uploads go. */
export interface EditorUploads {
  readonly upload: (file: File) => Promise<StoredFile>;
  /** The configured quota (`limits.maxAssetBytesPerSurvey`). */
  readonly maxAssetBytesPerSurvey: number;
}

/** The Creator's upload request (the part of its `onUploadFile` options used here). */
export interface UploadRequest {
  readonly files: readonly File[];
  readonly callback: (status: "success" | "error", fileUrl?: string) => void;
}

/**
 * Handles the Creator's upload requests: the first file is uploaded and its URL handed back. A
 * file larger than the whole quota is refused without a request. A failure is told through
 * `notify`.
 */
export function createUploadHandler(
  deps: EditorUploads & {
    readonly notify: (message: string) => void;
    /** True once the editor closed: a late result is ignored (no notify, no callback). */
    readonly isClosed?: () => boolean;
  },
): (request: UploadRequest) => void {
  const { maxAssetBytesPerSurvey } = deps;
  const closed = () => deps.isClosed?.() === true;
  return ({ files, callback }) => {
    const file = files[0];
    if (file === undefined) {
      callback("error");
      return;
    }
    if (file.size > maxAssetBytesPerSurvey) {
      deps.notify(quotaMessage(maxAssetBytesPerSurvey));
      callback("error");
      return;
    }
    deps
      .upload(file)
      .then(
        (stored) => {
          if (!closed()) callback("success", stored.url);
        },
        (error: unknown) => {
          if (closed()) return;
          deps.notify(uploadErrorMessage(error, maxAssetBytesPerSurvey));
          callback("error");
        },
      )
      // A throw in the Creator's callback is not an upload failure (the file is stored, and a
      // second callback would contradict the first); it only must not become an unhandled rejection.
      .catch(() => undefined);
  };
}
