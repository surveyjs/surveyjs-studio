import { describe, expect, it } from "vitest";
import { ApiError, type Problem } from "../api/client";
import type { StoredFile } from "../api/files";
import { STORAGE_FULL_TITLE } from "../api/storage-full";
import {
  createUploadHandler,
  formatBytes,
  uploadErrorMessage,
  type UploadRequest,
} from "./uploads";

const MAX = 1048576;

const problem = (status: number, code: Problem["code"]) =>
  new ApiError({ type: "about:blank", title: code, status, code });

/** Node's `process`, which runs these tests (the web project has no Node types). */
type UnhandledListener = (reason: unknown) => void;
const nodeProcess = (
  globalThis as unknown as {
    process: {
      on(event: "unhandledRejection", listener: UnhandledListener): void;
      off(event: "unhandledRejection", listener: UnhandledListener): void;
    };
  }
).process;

const QUOTA = "A survey can store up to 1 MB of files in total. This file was not uploaded.";
const TRY_AGAIN = "The file was not uploaded. Please try again.";

describe("formatBytes", () => {
  it.each([
    [52428800, "50 MB"],
    [1048576, "1 MB"],
    [1572864, "1.5 MB"],
    [10485760, "10 MB"],
    [65536, "64 KB"],
    [1024, "1 KB"],
    [1023, "1023 bytes"],
    [500, "500 bytes"],
  ])("%i → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("uploadErrorMessage", () => {
  it("tells a full browser storage (the sandbox's 413) apart from the survey's file quota", () => {
    const full = new ApiError({
      type: "https://studio.surveyjs.io/problems/quota-exceeded",
      title: STORAGE_FULL_TITLE,
      status: 413,
      code: "quota-exceeded",
    });
    expect(uploadErrorMessage(full, MAX)).toBe(
      "The browser's storage is full. This file was not uploaded.",
    );
    expect(uploadErrorMessage(problem(413, "quota-exceeded"), MAX)).toBe(QUOTA);
  });

  it.each([
    [
      "the quota, with the formatted limit",
      problem(413, "quota-exceeded"),
      "A survey can store up to 50 MB of files in total. This file was not uploaded.",
    ],
    [
      "a refused file type",
      problem(415, "unsupported-media-type"),
      "This file type cannot be uploaded. Use a PNG, JPEG, GIF, WebP, AVIF, BMP or SVG image, or an MP4, WebM or Ogg video.",
    ],
    [
      "no right to change the survey",
      problem(403, "forbidden"),
      "You cannot change this survey. The file was not uploaded.",
    ],
    [
      "a survey that is gone",
      problem(404, "not-found"),
      "This survey is no longer available. The file was not uploaded.",
    ],
    [
      "an ended session",
      problem(401, "unauthenticated"),
      "Your session has ended. Sign in again, then upload the file again.",
    ],
    ["a network failure", new TypeError("Failed to fetch"), TRY_AGAIN],
    ["a server error", problem(500, "internal-error"), TRY_AGAIN],
    ["an unreadable body", problem(400, "bad-request"), TRY_AGAIN],
    ["a refused part", problem(422, "validation-failed"), TRY_AGAIN],
  ])("tells about %s", (_, error, message) => {
    expect(uploadErrorMessage(error, 52428800)).toBe(message);
  });
});

const stored: StoredFile = {
  id: "f".repeat(64),
  url: "http://localhost:3000/api/v1/public/files/" + "f".repeat(64),
  name: "logo.png",
  contentType: "image/png",
  size: 3,
};

const fileOf = (size: number, name = "logo.png") => new File([new Uint8Array(size)], name);

/** A handler over a controllable upload; records what reaches the Creator and the user. */
function setUp(options: { closed?: () => boolean } = {}) {
  const uploaded: File[] = [];
  const notified: string[] = [];
  const callbacks: [status: string, url?: string][] = [];
  let answer: { resolve: (stored: StoredFile) => void; reject: (error: unknown) => void } | null =
    null;
  const handle = createUploadHandler({
    upload: (file) => {
      uploaded.push(file);
      return new Promise<StoredFile>((resolve, reject) => (answer = { resolve, reject }));
    },
    notify: (message) => notified.push(message),
    maxAssetBytesPerSurvey: MAX,
    isClosed: options.closed,
  });
  const request = (files: File[], callback?: UploadRequest["callback"]): UploadRequest => ({
    files,
    callback:
      callback ?? ((status, url) => callbacks.push(url === undefined ? [status] : [status, url])),
  });
  /** Lets the upload's answer reach the handler. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    uploaded,
    notified,
    callbacks,
    send: (files: File[], callback?: UploadRequest["callback"]) => handle(request(files, callback)),
    succeed: async () => {
      answer!.resolve(stored);
      await settle();
    },
    fail: async (error: unknown) => {
      answer!.reject(error);
      await settle();
    },
  };
}

describe("the upload handler", () => {
  it("refuses a file over the limit without uploading it", () => {
    const upload = setUp();

    upload.send([fileOf(MAX + 1)]);

    expect(upload.uploaded).toEqual([]);
    expect(upload.notified).toEqual([QUOTA]);
    expect(upload.callbacks).toEqual([["error"]]);
  });

  it("hands the stored file's URL back on success, without a notification", async () => {
    const upload = setUp();
    const file = fileOf(MAX);

    upload.send([file]);
    await upload.succeed();

    expect(upload.uploaded).toEqual([file]);
    expect(upload.callbacks).toEqual([["success", stored.url]]);
    expect(upload.notified).toEqual([]);
  });

  it("notifies once and reports an error when the upload fails", async () => {
    const upload = setUp();

    upload.send([fileOf(3)]);
    await upload.fail(problem(413, "quota-exceeded"));

    expect(upload.notified).toEqual([QUOTA]);
    expect(upload.callbacks).toEqual([["error"]]);
  });

  it("uploads only the first of two files", async () => {
    const upload = setUp();
    const first = fileOf(3, "first.png");

    upload.send([first, fileOf(3, "second.png")]);
    await upload.succeed();

    expect(upload.uploaded).toEqual([first]);
    expect(upload.callbacks).toEqual([["success", stored.url]]);
  });

  it("keeps a throw in the Creator's success callback from becoming an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    nodeProcess.on("unhandledRejection", onUnhandled);
    try {
      const upload = setUp();
      const statuses: string[] = [];

      upload.send([fileOf(3)], (status) => {
        statuses.push(status);
        throw new Error("Creator failed");
      });
      await upload.succeed();
      // Node reports unhandled rejections after the microtasks of a macrotask.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(statuses).toEqual(["success"]);
      expect(upload.notified).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports an error when there is no file", () => {
    const upload = setUp();

    upload.send([]);

    expect(upload.uploaded).toEqual([]);
    expect(upload.notified).toEqual([]);
    expect(upload.callbacks).toEqual([["error"]]);
  });

  it.each([
    ["a success", (upload: ReturnType<typeof setUp>) => upload.succeed()],
    ["a failure", (upload: ReturnType<typeof setUp>) => upload.fail(new TypeError("offline"))],
  ])("ignores %s that arrives after the editor closed", async (_, answer) => {
    let closed = false;
    const upload = setUp({ closed: () => closed });

    upload.send([fileOf(3)]);
    closed = true;
    await answer(upload);

    expect(upload.notified).toEqual([]);
    expect(upload.callbacks).toEqual([]);
  });
});
