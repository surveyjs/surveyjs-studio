// A respondent's files go to the survey's response files (S20), and the answers keep their URLs.
// No Form Library or React code here: `RunSurvey.tsx` connects this to the model's `onUploadFiles`.
import { ApiError } from "../api/client";
import type { StoredFile } from "../api/files";
import { formatBytes } from "../editor/uploads";

const tooLargeMessage = (maxFileBytes: number) =>
  `This file is too large. A file can be up to ${formatBytes(maxFileBytes)}.`;
const RATE_LIMITED = "Too many uploads. Wait a minute, then try again.";
const TRY_AGAIN = "The file was not uploaded. Please try again.";

/** What to tell the respondent when an upload failed with `error`. */
export function responseUploadMessage(error: unknown, maxFileBytes: number): string {
  const status = error instanceof ApiError ? error.problem.status : undefined;
  if (status === 413) return tooLargeMessage(maxFileBytes);
  if (status === 429) return RATE_LIMITED;
  return TRY_AGAIN;
}

/** The Form Library's upload request (the parts of its `onUploadFiles` options used here). */
export interface UploadFilesRequest {
  readonly files: readonly File[];
  readonly callback: (data: Array<{ file: File; content: string }>, errors?: string[]) => void;
}

/**
 * Handles a question's upload request: every file is uploaded (in parallel), and the library gets
 * each file with its stored URL, in the request's order. A file over `maxFileBytes` refuses the
 * whole request without a request to the server; any failed upload fails the request with the
 * first failure's message.
 */
export function createResponseUploadHandler(deps: {
  readonly upload: (file: File) => Promise<StoredFile>;
  /** The configured limit per file (`limits.maxFileBytes`). */
  readonly maxFileBytes: number;
}): (request: UploadFilesRequest) => void {
  const { maxFileBytes } = deps;
  return ({ files, callback }) => {
    if (files.length === 0) {
      callback([]);
      return;
    }
    if (files.some((file) => file.size > maxFileBytes)) {
      callback([], [tooLargeMessage(maxFileBytes)]);
      return;
    }
    Promise.all(files.map((file) => deps.upload(file)))
      .then(
        (stored) => callback(files.map((file, i) => ({ file, content: stored[i]!.url }))),
        (error: unknown) => callback([], [responseUploadMessage(error, maxFileBytes)]),
      )
      // A throw in the library's callback is not an upload failure (a second callback would
      // contradict the first); it only must not become an unhandled rejection.
      .catch(() => undefined);
  };
}
