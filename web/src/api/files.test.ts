import { afterEach, describe, expect, it } from "vitest";
import {
  sampleStoredFile,
  uploadAssetHandler,
  uploadProblemHandler,
  type SeenUpload,
} from "../test/file-handlers";
import { sampleSurvey, server } from "../test/server";
import { ApiError } from "./client";
import { uploadSurveyAsset } from "./files";

afterEach(() => {
  document.cookie = "msid_csrf=; Max-Age=0";
});

const logo = () => new File([new Uint8Array([137, 80, 78, 71, 0, 255, 13, 10])], "logo.png");

describe("uploading a survey asset", () => {
  it("posts one multipart file part with the CSRF header and resolves to the stored file", async () => {
    document.cookie = "msid_csrf=token-1";
    const seen: SeenUpload[] = [];
    server.use(uploadAssetHandler(sampleStoredFile, (upload) => seen.push(upload)));

    await expect(uploadSurveyAsset(sampleSurvey.id, logo())).resolves.toEqual(sampleStoredFile);

    expect(seen).toEqual([
      {
        path: `/api/v1/surveys/${sampleSurvey.id}/assets`,
        csrf: "token-1",
        contentType: expect.stringMatching(/^multipart\/form-data; boundary=/) as string,
        parts: [{ name: "file", fileName: "logo.png", bytes: [137, 80, 78, 71, 0, 255, 13, 10] }],
      },
    ]);
  });

  it.each([
    [413, "quota-exceeded"],
    [415, "unsupported-media-type"],
  ] as const)("rejects a %i with the %s ApiError", async (status, code) => {
    server.use(uploadProblemHandler(status));

    const error = await uploadSurveyAsset(sampleSurvey.id, logo()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({ status, code });
  });
});
