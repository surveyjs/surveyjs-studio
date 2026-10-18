import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteResultsHandler,
  resultPagesHandler,
  resultsProblemHandler,
  sampleResponses,
  statsHandler,
} from "../test/results-handlers";
import { sampleSurvey, server } from "../test/server";
import { ApiError } from "./client";
import {
  applyDeletedResults,
  deleteResults,
  loadAllResults,
  resultKeys,
  resultStatsQueryOptions,
  type ResultStats,
  useDeleteResults,
} from "./results";

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

const id = sampleSurvey.id;
const stats: ResultStats = {
  count: 3,
  firstSubmittedAt: "2026-01-01T00:00:00.000Z",
  lastSubmittedAt: "2026-01-01T00:02:00.000Z",
};
const noStats: ResultStats = { count: 0, firstSubmittedAt: null, lastSubmittedAt: null };

afterEach(() => {
  document.cookie = "msid_csrf=; Max-Age=0";
});

describe("resultStatsQueryOptions", () => {
  it("reads the statistics and keys them outside the results prefix", async () => {
    const urls: URL[] = [];
    server.use(statsHandler(stats, (url) => urls.push(url)));
    const queryClient = new QueryClient();

    await expect(queryClient.fetchQuery(resultStatsQueryOptions(id))).resolves.toEqual(stats);

    expect(urls.map((url) => url.pathname)).toEqual([`/api/v1/surveys/${id}/results/stats`]);
    expect(resultKeys.stats("ABC")).toEqual(["result-stats", "abc"]);
  });
});

describe("deleteResults", () => {
  it("sends DELETE with the CSRF token and resolves on 204", async () => {
    document.cookie = "msid_csrf=token-1";
    const seen: (string | null)[] = [];
    server.use(deleteResultsHandler((csrf) => seen.push(csrf)));

    await expect(deleteResults(id)).resolves.toBeUndefined();

    expect(seen).toEqual(["token-1"]);
  });

  it("rejects a 403 Problem with the forbidden ApiError", async () => {
    server.use(resultsProblemHandler("delete", "results", 403, "forbidden"));

    const error = await deleteResults(id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("applyDeletedResults and useDeleteResults", () => {
  const seeded = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(resultKeys.all(id), sampleResponses(3));
    queryClient.setQueryData(resultKeys.stats(id), stats);
    return queryClient;
  };

  it("empties the results and refetches the observed statistics", async () => {
    let current = stats;
    let reads = 0;
    server.use(
      statsHandler(() => {
        reads += 1;
        return current;
      }),
    );
    const queryClient = seeded();
    const observer = new QueryObserver(queryClient, {
      ...resultStatsQueryOptions(id),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    current = noStats;

    await applyDeletedResults(queryClient, id);

    expect(queryClient.getQueryData(resultKeys.all(id))).toEqual([]);
    expect(reads).toBe(1);
    expect(queryClient.getQueryData(resultKeys.stats(id))).toEqual(noStats);
    unsubscribe();
  });

  it("applies the deletion through the mutation hook", async () => {
    server.use(deleteResultsHandler(), statsHandler(noStats));
    const queryClient = seeded();
    const observer = new QueryObserver(queryClient, resultStatsQueryOptions(id));
    const unsubscribe = observer.subscribe(() => {});
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useDeleteResults(), { wrapper });

    result.current.mutate(id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(resultKeys.all(id))).toEqual([]);
    await waitFor(() => expect(queryClient.getQueryData(resultKeys.stats(id))).toEqual(noStats));
    unsubscribe();
  });

  it("leaves both caches unchanged when the deletion fails", async () => {
    server.use(resultsProblemHandler("delete", "results", 403, "forbidden"));
    const queryClient = seeded();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useDeleteResults(), { wrapper });

    result.current.mutate(id);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(resultKeys.all(id))).toEqual(sampleResponses(3));
    expect(queryClient.getQueryData(resultKeys.stats(id))).toEqual(stats);
    expect(queryClient.getQueryState(resultKeys.stats(id))?.isInvalidated).toBe(false);
  });
});
