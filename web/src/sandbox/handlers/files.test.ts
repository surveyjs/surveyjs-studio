import { describe, expect, it } from "vitest";
import seedJson from "../seed.json";
import { SESSION_COOKIE } from "../store";
import { ORIGIN, setupSandbox, SURVEYS, USERS } from "./testing";

const MAX = 200 * 1024;

/** The seed document's size in KB, as the store counts it. */
const seedKb = (JSON.stringify(seedJson).length * 2) / 1024;

const bytesOf = (size: number, fill = 7) => new Uint8Array(size).fill(fill);

function form(bytes: Uint8Array, name = "logo.png", field = "file"): FormData {
  const data = new FormData();
  data.append(field, new Blob([bytes as BlobPart], { type: "image/png" }), name);
  return data;
}

/** Sends `body` as a multipart request, signed in as `user` (or not). */
function upload(path: string, body: FormData, user: string | null = USERS.owner) {
  const headers = new Headers();
  if (user !== null) headers.set("Cookie", `${SESSION_COOKIE}=${user}`);
  return fetch(new Request(`${ORIGIN}/api/v1${path}`, { method: "POST", headers, body }));
}

const assets = (surveyId: string) => `/surveys/${surveyId}/assets`;
const respondentFiles = (surveyId: string) => `/public/surveys/${surveyId}/files`;

describe("uploadSurveyAsset", () => {
  it("stores a file and answers 201 with a StoredFile and a relative Location", async () => {
    setupSandbox();
    const response = await upload(assets(SURVEYS.feedback), form(bytesOf(100), "dot.png"));
    expect(response.status).toBe(201);
    const stored = await response.json();
    expect(stored).toStrictEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      url: `${ORIGIN}/api/v1/public/files/${stored.id}`,
      name: "dot.png",
      contentType: "image/png",
      size: 100,
    });
    // 32 hex digits of the survey GUID, then 32 random ones.
    expect(stored.id.startsWith(SURVEYS.feedback.replaceAll("-", ""))).toBe(true);
    expect(response.headers.get("location")).toBe(`/api/v1/public/files/${stored.id}`);
  });

  it("serves the stored URL with the same bytes and the server's headers", async () => {
    const { call } = setupSandbox();
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    const stored = await (
      await upload(assets(SURVEYS.feedback), form(bytes, "Ünï cöde.png"))
    ).json();
    const file = await call(`/public/files/${stored.id}`);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-length")).toBe("300");
    expect(file.headers.get("content-disposition")).toBe(
      "inline; filename=\"_n_ c_de.png\"; filename*=UTF-8''%C3%9Cn%C3%AF%20c%C3%B6de.png",
    );
    expect(file.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    );
    expect(file.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    // The id is matched without regard to case; an unknown or malformed id is 404.
    expect((await call(`/public/files/${stored.id.toUpperCase()}`)).status).toBe(200);
    for (const id of ["nope", "0".repeat(64)]) {
      const missing = await call(`/public/files/${id}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: "not-found" });
    }
  });

  it("serves a video as an attachment", async () => {
    const { call } = setupSandbox();
    const stored = await (
      await upload(assets(SURVEYS.feedback), form(bytesOf(10), "clip.mp4"))
    ).json();
    expect(stored.contentType).toBe("video/mp4");
    const file = await call(`/public/files/${stored.id}`);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("accepts a file of exactly maxUploadKb * 1024 bytes and refuses one byte more (413 quota-exceeded)", async () => {
    setupSandbox({ storageLimitKb: 4096 });
    const exact = await upload(assets(SURVEYS.feedback), form(bytesOf(MAX)));
    expect(exact.status).toBe(201);
    expect((await exact.json()).size).toBe(MAX);

    setupSandbox();
    const over = await upload(assets(SURVEYS.draft), form(bytesOf(MAX + 1)));
    expect(over.status).toBe(413);
    expect(over.headers.get("content-type")).toContain("application/problem+json");
    expect(await over.json()).toMatchObject({
      code: "quota-exceeded",
      status: 413,
      title: "File quota exceeded",
      detail: "This survey can store up to 200 KB of files.",
    });
  });

  it("counts the survey's assets towards the quota, and a used-up quota refuses any file", async () => {
    setupSandbox();
    expect((await upload(assets(SURVEYS.feedback), form(bytesOf(MAX - 10)))).status).toBe(201);
    const over = await upload(assets(SURVEYS.feedback), form(bytesOf(11)));
    expect(over.status).toBe(413);
    expect((await upload(assets(SURVEYS.feedback), form(bytesOf(10)))).status).toBe(201);
    const full = await upload(assets(SURVEYS.feedback), form(bytesOf(1)));
    expect(full.status).toBe(413);
    expect(await full.json()).toMatchObject({ code: "quota-exceeded" });
    // Another survey has its own quota.
    expect((await upload(assets(SURVEYS.draft), form(bytesOf(1)))).status).toBe(201);
  });

  it("answers 413 'Browser storage is full' when the stored size would overflow the document", async () => {
    const { ctx } = setupSandbox({ storageLimitKb: Math.ceil(seedKb) + 6 });
    // 10 KB is accepted by the quota, but its base64 form (and 2 bytes per character) is not.
    const response = await upload(assets(SURVEYS.feedback), form(bytesOf(10 * 1024)));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "quota-exceeded",
      title: "Browser storage is full",
    });
    expect(ctx.store.read().files).toEqual([]);
    // A small file still fits.
    expect((await upload(assets(SURVEYS.feedback), form(bytesOf(100)))).status).toBe(201);
  });

  it("is refused with the field, type, size and body problems the server answers", async () => {
    setupSandbox();
    const path = assets(SURVEYS.feedback);
    const wrongField = await upload(path, form(bytesOf(5), "a.png", "other"));
    expect(wrongField.status).toBe(422);
    expect(await wrongField.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/file", detail: "Send one file in the part named file." }],
    });
    const empty = await upload(path, form(bytesOf(0)));
    expect(empty.status).toBe(422);
    expect((await empty.json()).errors[0].detail).toBe("The file is empty.");
    const text = await upload(path, form(bytesOf(5), "notes.txt"));
    expect(text.status).toBe(415);
    expect(await text.json()).toMatchObject({ code: "unsupported-media-type" });
    // Another media type is 415 and no body at all is 422, before the survey is looked up.
    const notMultipart = await fetch(`${ORIGIN}/api/v1${assets("nope")}`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${USERS.owner}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(notMultipart.status).toBe(415);
    expect(await notMultipart.json()).toMatchObject({ code: "unsupported-media-type" });
    const noBody = await fetch(`${ORIGIN}/api/v1${path}`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${USERS.owner}` },
    });
    expect(noBody.status).toBe(422);
    expect(await noBody.json()).toMatchObject({ code: "validation-failed" });
  });

  it("answers 401 without a session, 404 for an invisible survey and 403 without modify rights", async () => {
    setupSandbox();
    expect((await upload(assets(SURVEYS.feedback), form(bytesOf(5)), null)).status).toBe(401);
    expect((await upload(assets(SURVEYS.feedback), form(bytesOf(5)), USERS.member)).status).toBe(
      404,
    );
    expect((await upload(assets("nope"), form(bytesOf(5)))).status).toBe(404);
    // The member sees the campaign but is no admin and not its creator.
    const forbidden = await upload(
      assets(SURVEYS.archivedCampaign),
      form(bytesOf(5)),
      USERS.member,
    );
    expect(forbidden.status).toBe(403);
  });
});

describe("uploadResponseFile", () => {
  it("stores any file of a published survey without signing in; unknown types are octet-stream", async () => {
    const { call, ctx } = setupSandbox();
    const response = await upload(
      respondentFiles(SURVEYS.feedback),
      form(bytesOf(50), "cv.pdf"),
      null,
    );
    expect(response.status).toBe(201);
    const stored = await response.json();
    expect(stored).toMatchObject({
      name: "cv.pdf",
      contentType: "application/octet-stream",
      size: 50,
    });
    expect(response.headers.get("location")).toBe(`/api/v1/public/files/${stored.id}`);
    expect(ctx.store.read().files[0]).toMatchObject({
      kind: "respondent",
      surveyId: SURVEYS.feedback,
    });
    const file = await call(`/public/files/${stored.id}`);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("refuses a file over maxUploadKb with 413 payload-too-large and an unpublished survey with 404", async () => {
    setupSandbox();
    const exact = await upload(respondentFiles(SURVEYS.feedback), form(bytesOf(MAX)), null);
    expect(exact.status).toBe(201);
    const over = await upload(respondentFiles(SURVEYS.feedback), form(bytesOf(MAX + 1)), null);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: "payload-too-large", title: "File too large" });
    const unpublished = await upload(respondentFiles(SURVEYS.retro), form(bytesOf(5)), null);
    expect(unpublished.status).toBe(404);
    expect(await unpublished.json()).toMatchObject({ code: "survey-not-available" });
  });
});
