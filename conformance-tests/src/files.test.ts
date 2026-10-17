/**
 * Editor uploads (`uploadSurveyAsset`) and public downloads (`downloadFile`) against the legacy
 * fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica and its file container
 * also keep it between runs), so every test that uploads creates its own surveys, in the admin's
 * Personal scope, and uploads only to those. No fixture survey gets a file: the checks on fixtures
 * are refused uploads (the 403 on Engineering retro, the 404s for the outsider), which store
 * nothing. Cleanup (archive, then delete) is registered with `onTestFinished` right after a survey is
 * created.
 */
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn, upload } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  campaign: "22222222-0000-4000-8000-a00000000004",
  engineeringRetro: "22222222-0000-4000-8000-a00000000006",
};

const ASSETS = "/surveys/{surveyId}/assets";
const DOWNLOAD = "/public/files/{fileId}";

type Headers = Record<string, string>;

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

/** The EBML header of a WebM file (doc type `webm`). */
const WEBM_HEADER = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
  0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04,
  0x42, 0x85, 0x81, 0x02,
]);

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

const sessions = new Map<string, SignInResult>();

/** Request headers of the user's browser; signs in once per user and test file. */
async function as(ctx: TestContext, user: { id: string }): Promise<Headers> {
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

/** Archives and deletes a survey the test created; a survey that is already gone is fine. */
async function cleanUp(headers: Headers, id: string): Promise<void> {
  const archived = await call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": "application/merge-patch+json", ...headers },
    body: { archived: true },
  });
  if (archived.status === 404) return;
  expect(archived.status).toBe(200);
  const deleted = await call("DELETE", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect([204, 404]).toContain(deleted.status);
}

/** Creates a survey in the user's Personal scope and registers its cleanup; returns its id. */
async function createdSurvey(headers: Headers): Promise<string> {
  const response = await call("POST", "/surveys", { headers, body: {} });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(() => cleanUp(headers, id));
  return id;
}

/** A form with one file part named `file` (or `field`), with the declared type and name. */
function fileForm(bytes: Buffer, name = "a.png", type = "image/png", field = "file"): FormData {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

function uploadTo(surveyId: string, headers: Headers | undefined, form: FormData) {
  return upload(ASSETS, { path: `/surveys/${surveyId}/assets`, ...(headers && { headers }), form });
}

/** Uploads a file the server must accept and returns what it stored. */
async function uploaded(
  surveyId: string,
  headers: Headers,
  form: FormData,
): Promise<{ response: Response; stored: StoredFile }> {
  const response = await uploadTo(surveyId, headers, form);
  expect(response.status).toBe(201);
  return { response, stored: (await response.json()) as StoredFile };
}

/** Downloads a file without cookies. */
function download(fileId: string): Promise<Response> {
  return call("GET", DOWNLOAD, { path: `/public/files/${fileId}` });
}

describe("uploadSurveyAsset and downloadFile", () => {
  it("stores a PNG and serves it to anyone", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);
    const { response, stored } = await uploaded(surveyId, headers, fileForm(PNG_1X1, "dot.png"));
    expect(stored).toStrictEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      url: expect.any(String) as string,
      name: "dot.png",
      contentType: "image/png",
      size: PNG_1X1.length,
    });
    const location = response.headers.get("location");
    expect(location).toBe(`/api/v1/public/files/${stored.id}`);
    // Absolute (the URL parser needs no base) and ending with the download path.
    expect(new URL(stored.url).href).toBe(stored.url);
    expect(stored.url.endsWith(`/api/v1/public/files/${stored.id}`)).toBe(true);

    const file = await download(stored.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toStrictEqual(PNG_1X1);
    expect(file.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(file.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");

    const upper = await download(stored.id.toUpperCase());
    expect(upper.status).toBe(200);
    await upper.body?.cancel();
  });

  it("serves a WebM video as an attachment and an SVG inline", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);

    const video = await uploaded(surveyId, headers, fileForm(WEBM_HEADER, "a.webm", "video/webm"));
    expect(video.stored.contentType).toBe("video/webm");
    const videoFile = await download(video.stored.id);
    expect(videoFile.headers.get("content-disposition")).toMatch(/^attachment;/);
    await videoFile.body?.cancel();

    const svg = await uploaded(surveyId, headers, fileForm(SVG, "a.svg", "image/svg+xml"));
    expect(svg.stored.contentType).toBe("image/svg+xml");
    const svgFile = await download(svg.stored.id);
    expect(svgFile.headers.get("content-type")).toBe("image/svg+xml");
    expect(svgFile.headers.get("content-disposition")).toMatch(/^inline;/);
    await svgFile.body?.cancel();
  });

  it("decides the type from the bytes, not the declared type or name", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);

    const html = Buffer.from("<!doctype html><html><body>hi</body></html>");
    const refused = await uploadTo(surveyId, headers, fileForm(html, "a.png", "image/png"));
    expect(refused.status).toBe(415);
    expect(await codeOf(refused)).toBe("unsupported-media-type");

    const { stored } = await uploaded(surveyId, headers, fileForm(PNG_1X1, "a.txt", "text/plain"));
    expect(stored.contentType).toBe("image/png");
    expect(stored.name).toBe("a.txt");
  });

  it("keeps a survey's files within limits.maxAssetBytesPerSurvey", async (ctx) => {
    const config = await call("GET", "/config");
    const limit = ((await config.json()) as { limits: { maxAssetBytesPerSurvey: number } }).limits
      .maxAssetBytesPerSurvey;
    const half = Math.floor(limit / 2);
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);
    const send = (size: number) => uploadTo(surveyId, headers, fileForm(pngOfSize(size)));

    const tooBig = await send(limit + 1);
    expect(tooBig.status).toBe(413);
    expect(await codeOf(tooBig)).toBe("quota-exceeded");
    expect((await send(half)).status).toBe(201);
    expect((await send(limit - half + 1)).status).toBe(413);
    expect((await send(limit - half)).status).toBe(201);
    const nothingLeft = await uploadTo(surveyId, headers, fileForm(PNG_1X1));
    expect(nothingLeft.status).toBe(413);
    expect(await codeOf(nothingLeft)).toBe("quota-exceeded");
  });

  it("refuses bodies without one non-empty file part", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);

    const textOnly = new FormData();
    textOnly.append("file", "not a file");
    const noFile = await uploadTo(surveyId, headers, textOnly);
    expect(noFile.status).toBe(422);
    expect(await codeOf(noFile)).toBe("validation-failed");

    const empty = await uploadTo(surveyId, headers, fileForm(Buffer.alloc(0)));
    expect(empty.status).toBe(422);
    expect(await codeOf(empty)).toBe("validation-failed");

    const json = await call("POST", ASSETS, {
      path: `/surveys/${surveyId}/assets`,
      headers,
      body: { file: "x" },
    });
    expect(json.status).toBe(415);
    expect(await codeOf(json)).toBe("unsupported-media-type");

    const boundary = "----cut";
    const cut = await call("POST", ASSETS, {
      path: `/surveys/${surveyId}/assets`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
      rawBody: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.png"',
        "Content-Type: image/png",
        "",
        "\u0089PNG and then the body ends",
      ].join("\r\n"),
    });
    expect(cut.status).toBe(400);
    expect(await codeOf(cut)).toBe("bad-request");
  });

  it("refuses callers who may not change the survey", async (ctx) => {
    const adminHeaders = await as(ctx, admin);
    const surveyId = await createdSurvey(adminHeaders);
    const form = () => fileForm(PNG_1X1);

    expect((await uploadTo(surveyId, undefined, form())).status).toBe(401);

    const noCsrf = await uploadTo(surveyId, { cookie: adminHeaders.cookie ?? "" }, form());
    expect(noCsrf.status).toBe(403);
    expect(await codeOf(noCsrf)).toBe("csrf-token-invalid");

    const forbidden = await uploadTo(fixture.engineeringRetro, await as(ctx, owner), form());
    expect(forbidden.status).toBe(403);
    expect(await codeOf(forbidden)).toBe("forbidden");

    const outsiderHeaders = await as(ctx, outsider);
    expect((await uploadTo(fixture.campaign, outsiderHeaders, form())).status).toBe(404);
    expect((await uploadTo(UNKNOWN_ID, adminHeaders, form())).status).toBe(404);
  });

  it("answers 404 for an unknown or malformed file id", async () => {
    const unknown = await download("0".repeat(64));
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe("not-found");
    expect((await download("abc")).status).toBe(404);
  });
});

/** Puts `definition` into the survey with the ETag of its current definition. */
async function saveDefinition(
  headers: Headers,
  surveyId: string,
  definition: object,
): Promise<void> {
  const path = `/surveys/${surveyId}/definition`;
  const current = await call("GET", "/surveys/{surveyId}/definition", { path, headers });
  expect(current.status).toBe(200);
  const saved = await call("PUT", "/surveys/{surveyId}/definition", {
    path,
    headers: { ...headers, "if-match": current.headers.get("etag") ?? "" },
    body: definition,
  });
  expect(saved.status).toBe(204);
}

async function bytesOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("files and the life of a survey", () => {
  it("deleting a survey deletes its files", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);
    const { stored } = await uploaded(surveyId, headers, fileForm(PNG_1X1));
    await saveDefinition(headers, surveyId, { title: "T", logo: stored.url });
    expect((await download(stored.id)).status).toBe(200);

    await cleanUp(headers, surveyId);
    expect((await download(stored.id)).status).toBe(404);
  });

  it("a copy has its own files with rewritten URLs and keeps them when the source is deleted", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await createdSurvey(headers);
    const { stored } = await uploaded(surveyId, headers, fileForm(PNG_1X1));
    await saveDefinition(headers, surveyId, { title: "T", logo: stored.url });

    const response = await call("POST", "/surveys/{surveyId}/clones", {
      path: `/surveys/${surveyId}/clones`,
      headers,
    });
    expect(response.status).toBe(201);
    const { id: copyId } = (await response.json()) as { id: string };
    onTestFinished(() => cleanUp(headers, copyId));

    const copied = await call("GET", "/surveys/{surveyId}/definition", {
      path: `/surveys/${copyId}/definition`,
      headers,
    });
    expect(copied.status).toBe(200);
    const { logo } = (await copied.json()) as { logo: string };
    expect(logo).toMatch(/\/public\/files\/[0-9a-f]{64}$/);
    expect(logo).not.toBe(stored.url);
    const copyFileId = logo.slice(logo.lastIndexOf("/") + 1);
    const file = await download(copyFileId);
    expect(file.status).toBe(200);
    expect(await bytesOf(file)).toEqual(PNG_1X1);

    await cleanUp(headers, surveyId);
    expect((await download(stored.id)).status).toBe(404);
    expect((await download(copyFileId)).status).toBe(200);
  });
});
