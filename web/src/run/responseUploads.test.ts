import { describe, expect, it } from "vitest";
import { ApiError, type Problem } from "../api/client";
import type { StoredFile } from "../api/files";
import {
  createResponseUploadHandler,
  responseUploadMessage,
  type UploadFilesRequest,
} from "./responseUploads";

const MAX = 1048576;
const TRY_AGAIN = "The file was not uploaded. Please try again.";

const problem = (status: number, code: Problem["code"]) =>
  new ApiError({ type: "about:blank", title: code, status, code });

const storedAs = (name: string): StoredFile => ({
  id: name.padEnd(64, "0"),
  url: `http://localhost:3000/api/v1/public/files/${name}`,
  name,
  contentType: "application/octet-stream",
  size: 3,
});

const fileOf = (size: number, name: string) => new File([new Uint8Array(size)], name);

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

/** Lets the uploads' answers reach the handler. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Callback = Parameters<UploadFilesRequest["callback"]>;

/** A handler whose uploads answer through `answer(file)`; records uploads and callbacks. */
function setUp(answer: (file: File) => Promise<StoredFile>) {
  const uploaded: File[] = [];
  const callbacks: Callback[] = [];
  const handle = createResponseUploadHandler({
    upload: (file) => {
      uploaded.push(file);
      return answer(file);
    },
    maxFileBytes: MAX,
  });
  return {
    uploaded,
    callbacks,
    send: (files: File[], callback?: UploadFilesRequest["callback"]) =>
      handle({ files, callback: callback ?? ((...args) => callbacks.push(args)) }),
  };
}

describe("responseUploadMessage", () => {
  it.each([
    [
      "a file over the limit",
      problem(413, "payload-too-large"),
      "This file is too large. A file can be up to 1 MB.",
    ],
    [
      "the rate limit",
      problem(429, "rate-limited"),
      "Too many uploads. Wait a minute, then try again.",
    ],
    ["a network failure", new TypeError("Failed to fetch"), TRY_AGAIN],
    ["a server error", problem(500, "internal-error"), TRY_AGAIN],
    ["a survey that is gone", problem(404, "survey-not-available"), TRY_AGAIN],
  ])("tells about %s", (_, error, message) => {
    expect(responseUploadMessage(error, MAX)).toBe(message);
  });
});

describe("the response upload handler", () => {
  it("uploads every file and hands each one back with its URL, in order", async () => {
    // The first upload answers last: the order is the request's, not the answers'.
    const upload = setUp((file) =>
      file.name === "first.pdf"
        ? new Promise((resolve) => setTimeout(() => resolve(storedAs("first.pdf")), 5))
        : Promise.resolve(storedAs(file.name)),
    );
    const first = fileOf(3, "first.pdf");
    const second = fileOf(3, "second.png");

    upload.send([first, second]);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(upload.uploaded).toEqual([first, second]);
    expect(upload.callbacks).toEqual([
      [
        [
          { file: first, content: storedAs("first.pdf").url },
          { file: second, content: storedAs("second.png").url },
        ],
      ],
    ]);
  });

  it("refuses the request without uploading when a file is over the limit", () => {
    const upload = setUp((file) => Promise.resolve(storedAs(file.name)));

    upload.send([fileOf(3, "small.png"), fileOf(MAX + 1, "big.mp4")]);

    expect(upload.uploaded).toEqual([]);
    expect(upload.callbacks).toEqual([[[], ["This file is too large. A file can be up to 1 MB."]]]);
  });

  it.each([
    [problem(413, "payload-too-large"), "This file is too large. A file can be up to 1 MB."],
    [problem(429, "rate-limited"), "Too many uploads. Wait a minute, then try again."],
    [new TypeError("Failed to fetch"), TRY_AGAIN],
  ])("fails the request when an upload fails with %s", async (error, message) => {
    const upload = setUp((file) =>
      file.name === "bad.png" ? Promise.reject(error) : Promise.resolve(storedAs(file.name)),
    );

    upload.send([fileOf(3, "good.png"), fileOf(3, "bad.png")]);
    await settle();

    expect(upload.callbacks).toEqual([[[], [message]]]);
  });

  it("answers an empty request with no files", () => {
    const upload = setUp((file) => Promise.resolve(storedAs(file.name)));

    upload.send([]);

    expect(upload.uploaded).toEqual([]);
    expect(upload.callbacks).toEqual([[[]]]);
  });

  it("keeps a throw in the library's callback from becoming an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    nodeProcess.on("unhandledRejection", onUnhandled);
    try {
      const upload = setUp((file) => Promise.resolve(storedAs(file.name)));
      let calls = 0;

      upload.send([fileOf(3, "a.png")], () => {
        calls += 1;
        throw new Error("library failed");
      });
      await settle();
      await settle();

      expect(calls).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled);
    }
  });
});
