import type { components } from "@my-surveys/contract/types";
import { client, toApiError } from "./client";

export type StoredFile = components["schemas"]["StoredFile"];

/**
 * Uploads `file` to the survey's editor assets (`POST /surveys/{id}/assets`, multipart part `file`
 * with the file's name; the CSRF middleware adds its header). Resolves to the stored file; rejects
 * with `ApiError` (`quota-exceeded`, `unsupported-media-type`, …).
 */
export async function uploadSurveyAsset(surveyId: string, file: File): Promise<StoredFile> {
  const { data, error, response } = await client.POST("/surveys/{surveyId}/assets", {
    params: { path: { surveyId } },
    // The contract types the part as a string (OpenAPI `format: binary`): the File stands in for
    // it, and the serializer sends it as the part. A FormData body goes out as it is, and the
    // browser sets the multipart Content-Type with its boundary.
    body: { file: file as unknown as string },
    bodySerializer: () => {
      const form = new FormData();
      form.append("file", file, file.name);
      return form;
    },
  });
  if (!response.ok || data === undefined) throw toApiError(error, response);
  return data;
}
