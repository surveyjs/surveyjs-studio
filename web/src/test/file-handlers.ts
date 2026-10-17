import { HttpResponse, http as mswHttp } from "msw";
import type { components } from "@my-surveys/contract/types";
import { http, sampleSurvey } from "./server";

type StoredFile = components["schemas"]["StoredFile"];

const fileId = `${sampleSurvey.id.replaceAll("-", "")}${"ab".repeat(16)}`;

export const sampleStoredFile: StoredFile = {
  id: fileId,
  url: `http://localhost:3000/api/v1/public/files/${fileId}`,
  name: "logo.png",
  contentType: "image/png",
  size: 68,
};

/** One part of a multipart body. */
export interface SeenPart {
  readonly name: string | undefined;
  readonly fileName: string | undefined;
  readonly bytes: number[];
}

/** What an upload handler saw. */
export interface SeenUpload {
  readonly path: string;
  readonly csrf: string | null;
  readonly contentType: string | null;
  readonly parts: SeenPart[];
}

/**
 * The parts of a `multipart/form-data` body. Parsed here: Node's own parser (`request.formData()`)
 * fails under jsdom, whose `File` replaces Node's.
 */
function multipartParts(bytes: Uint8Array, contentType: string | null): SeenPart[] {
  const boundary = /boundary=([^;]+)/.exec(contentType ?? "")?.[1];
  if (boundary === undefined) return [];
  // One character per byte, so the bytes come back unchanged.
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return text
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const part = chunk.slice(2, -2); // the CRLF after the boundary and before the next one
      const split = part.indexOf("\r\n\r\n");
      const head = part.slice(0, split);
      return {
        name: /\bname="([^"]*)"/.exec(head)?.[1],
        fileName: /\bfilename="([^"]*)"/.exec(head)?.[1],
        bytes: Array.from(part.slice(split + 4), (char) => char.charCodeAt(0)),
      };
    });
}

/** Answers `POST /surveys/{id}/assets` with 201 and `stored`; `onUpload` sees the request. */
export function uploadAssetHandler(
  stored: StoredFile = sampleStoredFile,
  onUpload?: (upload: SeenUpload) => void,
) {
  return http.post("/surveys/{surveyId}/assets", async ({ request, response }) => {
    const contentType = request.headers.get("Content-Type");
    onUpload?.({
      path: new URL(request.url).pathname,
      csrf: request.headers.get("X-CSRF-Token"),
      contentType,
      parts: multipartParts(new Uint8Array(await request.arrayBuffer()), contentType),
    });
    return response(201).json(stored, {
      headers: { Location: `/api/v1/public/files/${stored.id}` },
    });
  });
}

const problems = {
  400: { code: "bad-request", title: "Bad request" },
  401: { code: "unauthenticated", title: "Sign in required" },
  403: { code: "forbidden", title: "Forbidden" },
  404: { code: "not-found", title: "Not found" },
  413: { code: "quota-exceeded", title: "File quota exceeded" },
  415: { code: "unsupported-media-type", title: "Unsupported file type" },
  422: { code: "validation-failed", title: "Validation failed" },
  500: { code: "internal-error", title: "Server error" },
} as const;

export type UploadProblemStatus = keyof typeof problems;

/** Answers `POST /surveys/{id}/assets` with the Problem the server sends for `status`. */
export function uploadProblemHandler(status: UploadProblemStatus) {
  const { code, title } = problems[status];
  return mswHttp.post("*/api/v1/surveys/:surveyId/assets", () =>
    HttpResponse.json(
      { type: `https://my-surveys.surveyjs.io/problems/${code}`, title, status, code },
      { status, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}
