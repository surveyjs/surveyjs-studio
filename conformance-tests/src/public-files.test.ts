/**
 * Respondent file uploads (`uploadResponseFile`) and their downloads against the legacy fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica and its file container
 * keep it between runs), so every test that uploads creates its own survey in the admin's Personal
 * scope (published through `PATCH`, as `public.test.ts` does) and uploads only to that one. No
 * fixture survey gets a file: the checks on fixtures are refused uploads. Cleanup (archive, then
 * delete) is registered with `onTestFinished` right after a survey is created.
 */
import { describe, expect, it } from "vitest";
import {
  baseUrl,
  call,
  codeOf,
  expectConforms,
  upload,
  as,
  cleanUp,
  newSurvey,
  ownSurvey,
} from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { admin } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
/** "Engineering retro": its published flag is 0. */
const UNPUBLISHED_FIXTURE = "22222222-0000-4000-8000-a00000000006";

const UPLOAD = "/public/surveys/{surveyId}/files";
const DOWNLOAD = "/public/files/{fileId}";

interface StoredFile {
  id: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
}

/** A valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** The 1×1 PNG followed by padding after its IEND chunk: still a PNG, exactly `size` bytes long. */
function pngOfSize(size: number): Buffer {
  return Buffer.concat([PNG_1X1, Buffer.alloc(size - PNG_1X1.length)]);
}

/** The start of a PDF: not an allowed image or video type, so it is stored as octet-stream. */
const PDF_LIKE = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

/** A form with one file part named `file` (or `field`), with the declared type and name. */
function fileForm(bytes: Buffer, name = "a.png", type = "image/png", field = "file"): FormData {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

/** Uploads without cookies: respondents have no session. */
function uploadTo(surveyId: string, form: FormData) {
  return upload(UPLOAD, { path: `/public/surveys/${surveyId}/files`, form });
}

/** Uploads a file the server must accept and returns what it stored. */
async function uploaded(
  surveyId: string,
  form: FormData,
): Promise<{ response: Response; stored: StoredFile }> {
  const response = await uploadTo(surveyId, form);
  expect(response.status).toBe(201);
  return { response, stored: (await response.json()) as StoredFile };
}

/** Downloads a file without cookies. */
function download(fileId: string): Promise<Response> {
  return call("GET", DOWNLOAD, { path: `/public/files/${fileId}` });
}

/** `limits.maxFileBytes` from the public config. */
async function maxFileBytes(): Promise<number> {
  const response = await call("GET", "/config");
  const config = (await response.json()) as { limits: { maxFileBytes: number } };
  return config.limits.maxFileBytes;
}

describe("uploadResponseFile", () => {
  it("stores a PNG for a published survey and serves it inline to anyone", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const { response, stored } = await uploaded(surveyId, fileForm(PNG_1X1, "dot.png"));
    expect(stored).toStrictEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      url: expect.any(String) as string,
      name: "dot.png",
      contentType: "image/png",
      size: PNG_1X1.length,
    });
    expect(response.headers.get("location")).toBe(`/api/v1/public/files/${stored.id}`);
    expect(stored.url.endsWith(`/api/v1/public/files/${stored.id}`)).toBe(true);

    const file = await download(stored.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(Buffer.from(await file.arrayBuffer())).toStrictEqual(PNG_1X1);
  });

  it("stores a file for a new survey, whose empty published flag means published", async (ctx) => {
    const surveyId = await newSurvey(await as(ctx, admin));
    const { stored } = await uploaded(surveyId, fileForm(PNG_1X1, "new.png"));
    expect((await download(stored.id)).status).toBe(200);
  });

  it("stores a file of another type as octet-stream and serves it as an attachment", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const { stored } = await uploaded(surveyId, fileForm(PDF_LIKE, "doc.pdf", "application/pdf"));
    expect(stored).toMatchObject({
      name: "doc.pdf",
      contentType: "application/octet-stream",
      size: PDF_LIKE.length,
    });

    const file = await download(stored.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await file.arrayBuffer())).toStrictEqual(PDF_LIKE);
  });

  it("accepts a file of exactly limits.maxFileBytes and refuses one byte more", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const max = await maxFileBytes();
    const exact = await uploaded(surveyId, fileForm(pngOfSize(max)));
    expect(exact.stored.size).toBe(max);

    const response = await uploadTo(surveyId, fileForm(pngOfSize(max + 1)));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "payload-too-large",
      title: "File too large",
    });
  });

  it("answers 422 for a form without a file and for an empty file", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const text = new FormData();
    text.append("note", "hello");
    const noFile = await uploadTo(surveyId, text);
    expect(noFile.status).toBe(422);
    expect(await codeOf(noFile)).toBe("validation-failed");

    const empty = await uploadTo(surveyId, fileForm(Buffer.alloc(0)));
    expect(empty.status).toBe(422);
    expect(await codeOf(empty)).toBe("validation-failed");
  });

  it("answers 415 for a JSON body", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const response = await call("POST", UPLOAD, {
      path: `/public/surveys/${surveyId}/files`,
      body: { file: "x" },
    });
    expect(response.status).toBe(415);
    expect(await codeOf(response)).toBe("unsupported-media-type");
  });

  it("answers 400 for a cut multipart body", async (ctx) => {
    const surveyId = await ownSurvey(await as(ctx, admin));
    const boundary = "----conformance-cut";
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
      "Content-Type: image/png\r\n\r\n";
    const response = await fetch(`${baseUrl}/api/v1/public/surveys/${surveyId}/files`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      // No closing boundary: the body ends inside the file part.
      body: Buffer.concat([Buffer.from(head), PNG_1X1]),
    });
    await expectConforms("POST", UPLOAD, response);
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 404 survey-not-available for unpublished and unknown surveys", async (ctx) => {
    const unpublished = await ownSurvey(await as(ctx, admin), { published: false });
    for (const surveyId of [unpublished, UNPUBLISHED_FIXTURE, UNKNOWN_ID]) {
      const response = await uploadTo(surveyId, fileForm(PNG_1X1));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: "survey-not-available",
        title: "This survey is not available",
      });
    }
  });

  it("deletes the file with its survey", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers);
    const { stored } = await uploaded(surveyId, fileForm(PDF_LIKE, "doc.pdf"));
    expect((await download(stored.id)).status).toBe(200);

    await cleanUp(headers, surveyId);
    expect((await download(stored.id)).status).toBe(404);
  });
});
