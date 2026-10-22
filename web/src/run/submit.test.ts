import { describe, expect, it, vi } from "vitest";
import { ApiError, type Problem } from "../api/client";
import type { ResponseBody } from "../api/public";
import { createSubmitHandler, SUBMIT_MESSAGES, type SaveOptions } from "./submit";

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

/** Lets a settled request reach the handler. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const saveOptions = () => ({
  showSaveInProgress: vi.fn<SaveOptions["showSaveInProgress"]>(),
  showSaveSuccess: vi.fn<SaveOptions["showSaveSuccess"]>(),
  showSaveError: vi.fn<SaveOptions["showSaveError"]>(),
});

/** A handler over a controllable submit; records each request. */
function setUp(clientId?: string) {
  const requests: { body: ResponseBody; key: string }[] = [];
  let answer: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  let keys = 0;
  const handle = createSubmitHandler({
    submit: (body, key) => {
      requests.push({ body, key });
      return new Promise((resolve, reject) => {
        answer = { resolve: () => resolve({ id: "response-1" }), reject };
      });
    },
    clientId: () => Promise.resolve(clientId),
    newKey: () => `key-${++keys}`,
  });
  const setCookie = vi.fn<() => void>();
  const deleteCookie = vi.fn<() => void>();
  return {
    requests,
    setCookie,
    deleteCookie,
    send: (options: SaveOptions, data: Record<string, unknown> = { satisfaction: 4 }) =>
      handle({ data, setCookie, deleteCookie }, options),
    /** Lets the handler read the client id and start its request. */
    started: settle,
    succeed: async () => {
      await settle();
      answer!.resolve();
      await settle();
    },
    fail: async (error: unknown) => {
      await settle();
      answer!.reject(error);
      await settle();
    },
  };
}

describe("the submit handler", () => {
  it("shows the saving state, then the library's success text", async () => {
    const submit = setUp();
    const options = saveOptions();

    submit.send(options);
    expect(options.showSaveInProgress).toHaveBeenCalledExactlyOnceWith();
    expect(options.showSaveSuccess).not.toHaveBeenCalled();
    await submit.succeed();

    expect(options.showSaveSuccess).toHaveBeenCalledExactlyOnceWith();
    expect(options.showSaveError).not.toHaveBeenCalled();
  });

  it("keeps the library's cookie once the answers are stored", async () => {
    const submit = setUp("client-1");

    submit.send(saveOptions());
    await submit.succeed();

    expect(submit.setCookie).toHaveBeenCalledOnce();
    expect(submit.deleteCookie).not.toHaveBeenCalled();
  });

  it("sends the answers, the client id and a key", async () => {
    const submit = setUp("client-1");

    submit.send(saveOptions(), { satisfaction: 5 });
    await submit.started();

    expect(submit.requests).toEqual([
      { body: { data: { satisfaction: 5 }, clientId: "client-1" }, key: "key-1" },
    ]);
  });

  it("sends no client id when the limit is off", async () => {
    const submit = setUp();

    submit.send(saveOptions());
    await submit.started();

    expect(submit.requests).toEqual([{ body: { data: { satisfaction: 4 } }, key: "key-1" }]);
  });

  it("sends nothing more while a request is in flight", async () => {
    const submit = setUp();
    const second = saveOptions();

    submit.send(saveOptions());
    submit.send(second);
    await submit.started();

    expect(submit.requests).toHaveLength(1);
    expect(second.showSaveInProgress).not.toHaveBeenCalled();
  });

  it("retries a failure with the same key", async () => {
    const submit = setUp();
    const options = saveOptions();

    submit.send(options);
    await submit.fail(new TypeError("Failed to fetch"));
    submit.send(options);
    await submit.succeed();

    expect(submit.requests.map(({ key }) => key)).toEqual(["key-1", "key-1"]);
    expect(options.showSaveInProgress).toHaveBeenCalledTimes(2);
    expect(options.showSaveSuccess).toHaveBeenCalledExactlyOnceWith();
    // Deleted after the failure, written again once the retry stores the answers.
    expect(submit.deleteCookie).toHaveBeenCalledOnce();
    expect(submit.setCookie).toHaveBeenCalledOnce();
    expect(submit.deleteCookie.mock.invocationCallOrder[0]).toBeLessThan(
      submit.setCookie.mock.invocationCallOrder[0]!,
    );
  });

  it("tells a respondent who has completed the survey before, as a success", async () => {
    const submit = setUp("client-1");
    const options = saveOptions();

    submit.send(options);
    await submit.fail(problem(409, "already-completed"));

    expect(options.showSaveSuccess).toHaveBeenCalledExactlyOnceWith(
      "You have already completed this survey.",
    );
    expect(options.showSaveError).not.toHaveBeenCalled();
    expect(submit.setCookie).toHaveBeenCalledOnce();
    expect(submit.deleteCookie).not.toHaveBeenCalled();

    submit.send(options);
    expect(submit.requests).toHaveLength(1);
    expect(options.showSaveSuccess).toHaveBeenLastCalledWith(SUBMIT_MESSAGES.alreadyCompleted);
  });

  it.each([
    ["a 413", problem(413, "payload-too-large"), "Your answers are too large to send."],
    ["a 429", problem(429, "rate-limited"), "Too many attempts. Wait a minute, then try again."],
    [
      "a 500",
      problem(500, "internal-error"),
      "Your answers were not sent. Check your connection and try again.",
    ],
    [
      "a network failure",
      new TypeError("Failed to fetch"),
      "Your answers were not sent. Check your connection and try again.",
    ],
  ])("shows an error for %s", async (_, error, message) => {
    const submit = setUp();
    const options = saveOptions();

    submit.send(options);
    await submit.fail(error);

    expect(options.showSaveError).toHaveBeenCalledExactlyOnceWith(message);
    expect(options.showSaveSuccess).not.toHaveBeenCalled();
    // A reload must not show the library's "already completed" content with nothing stored.
    expect(submit.deleteCookie).toHaveBeenCalledOnce();
    expect(submit.setCookie).not.toHaveBeenCalled();
  });

  it("sends nothing after a success, and shows the success again", async () => {
    const submit = setUp();
    const options = saveOptions();

    submit.send(options);
    await submit.succeed();
    submit.send(options);

    expect(submit.requests).toHaveLength(1);
    expect(options.showSaveInProgress).toHaveBeenCalledOnce();
    expect(options.showSaveSuccess).toHaveBeenCalledTimes(2);
    expect(options.showSaveSuccess).toHaveBeenLastCalledWith();
  });

  it("keeps a throw in showSaveSuccess from becoming an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    nodeProcess.on("unhandledRejection", onUnhandled);
    try {
      const submit = setUp();
      const options = saveOptions();
      options.showSaveSuccess.mockImplementation(() => {
        throw new Error("library failed");
      });

      submit.send(options);
      await submit.succeed();
      // Node reports unhandled rejections after the microtasks of a macrotask.
      await settle();

      expect(options.showSaveSuccess).toHaveBeenCalledOnce();
      expect(options.showSaveError).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("the submit handler's own key", () => {
  it("is a version 4 UUID without crypto.randomUUID (plain HTTP), reused on retry", async () => {
    const realCrypto = globalThis.crypto;
    // Outside a secure context the browser's crypto has getRandomValues but no randomUUID.
    vi.stubGlobal("crypto", { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    try {
      const keys: string[] = [];
      let attempt = 0;
      const handle = createSubmitHandler({
        submit: (_body, key) => {
          keys.push(key);
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new TypeError("Failed to fetch"))
            : Promise.resolve({ id: "response-1" });
        },
        clientId: () => Promise.resolve(undefined),
      });
      const sender = { data: { satisfaction: 4 }, setCookie: vi.fn(), deleteCookie: vi.fn() };
      const options = saveOptions();

      handle(sender, options);
      await settle();
      expect(options.showSaveError).toHaveBeenCalledOnce();
      handle(sender, options);
      await settle();

      expect(options.showSaveSuccess).toHaveBeenCalledExactlyOnceWith();
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(keys[1]).toBe(keys[0]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(globalThis.crypto).toBe(realCrypto);
  });
});
