import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it } from "vitest";
import { resultPagesHandler, sampleResponses } from "../test/results-handlers";
import { sampleSurvey, server } from "../test/server";
import { ApiError } from "./client";
import { loadAllResults } from "./results";

describe("loadAllResults", () => {
  it("reads page after page and concatenates the items in order", async () => {
    const seen: URL[] = [];
    const pages = [sampleResponses(2), sampleResponses(1, 3)];
    server.use(resultPagesHandler(pages, (url) => seen.push(url)));

    await expect(loadAllResults(sampleSurvey.id)).resolves.toEqual([...pages[0]!, ...pages[1]!]);

    expect(
      seen.map((url) => [url.searchParams.get("limit"), url.searchParams.get("cursor")]),
    ).toEqual([
      ["1000", null],
      ["1000", "c1"],
    ]);
  });

  it("rejects with the ApiError of a failed page", async () => {
    server.use(
      mswHttp.get("*/api/v1/surveys/:surveyId/results", ({ request }) =>
        new URL(request.url).searchParams.has("cursor")
          ? HttpResponse.json(
              { type: "about:blank", title: "Oops", status: 500, code: "internal-error" },
              { status: 500, headers: { "Content-Type": "application/problem+json" } },
            )
          : HttpResponse.json({ items: sampleResponses(1), nextCursor: "c1" }),
      ),
    );

    const error = await loadAllResults(sampleSurvey.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.status).toBe(500);
  });

  it("rejects when the server answers the cursor it was sent", async () => {
    server.use(
      mswHttp.get("*/api/v1/surveys/:surveyId/results", () =>
        HttpResponse.json({ items: [], nextCursor: "c1" }),
      ),
    );

    await expect(loadAllResults(sampleSurvey.id)).rejects.toThrow(
      "The server sent the same cursor twice.",
    );
  });

  it("rejects when the signal is aborted", async () => {
    server.use(resultPagesHandler([sampleResponses(1)]));
    const controller = new AbortController();
    controller.abort();

    await expect(loadAllResults(sampleSurvey.id, controller.signal)).rejects.toThrow();
  });
});
