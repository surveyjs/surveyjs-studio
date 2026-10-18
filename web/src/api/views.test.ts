import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetViewHandler,
  saveViewHandler,
  viewHandler,
  viewProblemHandler,
  type SeenViewSave,
} from "../test/results-handlers";
import { sampleSurvey, server } from "../test/server";
import { ApiError } from "./client";
import { getResultsView, resetResultsView, saveResultsView } from "./views";

afterEach(() => {
  document.cookie = "msid_csrf=; Max-Age=0";
});

describe("getResultsView", () => {
  it("answers null for a view-not-found 404", async () => {
    server.use(viewHandler("table", null));
    await expect(getResultsView(sampleSurvey.id, "table")).resolves.toBeNull();
  });

  it("rejects the not-found 404 of an unknown survey", async () => {
    server.use(viewProblemHandler("get", "table", 404, "not-found"));
    const error = await getResultsView(sampleSurvey.id, "table").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("not-found");
  });

  it("answers the stored state", async () => {
    server.use(viewHandler("summary", { locale: "", elements: [] }));
    await expect(getResultsView(sampleSurvey.id, "summary")).resolves.toEqual({
      locale: "",
      elements: [],
    });
  });
});

describe("saveResultsView and resetResultsView", () => {
  it("sends the state as JSON with the CSRF header", async () => {
    document.cookie = "msid_csrf=token-1";
    const seen: SeenViewSave[] = [];
    server.use(saveViewHandler("table", (saved) => seen.push(saved)));

    await expect(
      saveResultsView(sampleSurvey.id, "table", { pageSize: 10 }),
    ).resolves.toBeUndefined();

    expect(seen).toEqual([{ body: { pageSize: 10 }, csrf: "token-1" }]);
  });

  it.each([
    ["a small state", { a: "x" }, true],
    ["an ASCII state over 60,000 bytes", { a: "x".repeat(60_000) }, false],
    // 25,000 characters of 3 bytes each: under 60,000 characters, over 60,000 bytes.
    [
      "a non-ASCII state under 60,000 characters but over 60,000 bytes",
      { a: "€".repeat(25_000) },
      false,
    ],
  ])("sets keepalive for %s: %s", async (_name, state, keepalive) => {
    const seen: { keepalive: boolean; contentType: string | null; body: unknown }[] = [];
    server.use(
      mswHttp.put("*/api/v1/surveys/:surveyId/views/table", async ({ request }) => {
        seen.push({
          keepalive: request.keepalive,
          contentType: request.headers.get("Content-Type"),
          body: await request.json(),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await saveResultsView(sampleSurvey.id, "table", state);

    expect(seen).toEqual([{ keepalive, contentType: "application/json", body: state }]);
  });

  it("rejects a failed save", async () => {
    server.use(viewProblemHandler("put", "table", 413, "payload-too-large"));
    await expect(saveResultsView(sampleSurvey.id, "table", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("sends a DELETE", async () => {
    let resets = 0;
    server.use(resetViewHandler("summary", () => resets++));
    await expect(resetResultsView(sampleSurvey.id, "summary")).resolves.toBeUndefined();
    expect(resets).toBe(1);
  });
});
