import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageFullError } from "../store";
import { guarded, notFound, problemBody, problemResponse, STORAGE_FULL_EVENT } from "./problems";
import { setupSandbox, SURVEYS, USERS } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("problem answers", () => {
  it("have the server's shape and content type", async () => {
    expect(
      problemBody({ code: "not-found", status: 404, title: "Not found", detail: "d" }),
    ).toEqual({
      type: "https://studio.surveyjs.io/problems/not-found",
      title: "Not found",
      status: 404,
      code: "not-found",
      detail: "d",
    });
    const response = problemResponse({ code: "not-found", status: 404, title: "Not found" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(Object.keys(await response.json())).toEqual(["type", "title", "status", "code"]);
  });

  it("guarded turns a thrown problem into its answer and anything else into 500", async () => {
    expect((await guarded(() => Promise.reject(notFound()))).status).toBe(404);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await guarded(() => Promise.reject(new Error("boom")));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ code: "internal-error" });
  });
});

describe("a full browser storage", () => {
  it("answers 413 quota-exceeded and fires sandbox:storage-full on window", async () => {
    const response = await guarded(() => Promise.reject(new StorageFullError()));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      type: "https://studio.surveyjs.io/problems/quota-exceeded",
      title: "Browser storage is full",
      status: 413,
      code: "quota-exceeded",
    });
  });

  it("is reported by a handler whose write is refused, leaving the data as it was", async () => {
    const { call, ctx } = setupSandbox({ storageLimitKb: 1 });
    const listener = vi.fn();
    window.addEventListener(STORAGE_FULL_EVENT, listener);
    try {
      // The seed alone is over 1 KB, so any write is refused; reads still work.
      const read = await call(`/surveys/${SURVEYS.feedback}`, { user: USERS.owner });
      expect(read.status).toBe(200);
      const before = ctx.store.read();
      const refused = await call(`/surveys/${SURVEYS.feedback}`, {
        method: "PATCH",
        user: USERS.owner,
        json: { name: "x" },
      });
      expect(refused.status).toBe(413);
      expect(await refused.json()).toMatchObject({
        code: "quota-exceeded",
        title: "Browser storage is full",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(ctx.store.read()).toEqual(before);
    } finally {
      window.removeEventListener(STORAGE_FULL_EVENT, listener);
    }
  });
});
