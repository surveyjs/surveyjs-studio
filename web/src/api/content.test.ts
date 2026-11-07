import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  definitionHandler,
  editConflictHandler,
  historyEntryHandler,
  historyHandler,
  saveDefinitionHandler,
  saveThemeHandler,
  themeHandler,
  type SavedContent,
} from "../test/content-handlers";
import { sampleSurvey, server } from "../test/server";
import { ApiError } from "./client";
import {
  contentKeys,
  definitionQueryOptions,
  historyEntryQueryOptions,
  historyInfiniteQueryOptions,
  markSavedContentStale,
  saveDefinition,
  saveTheme,
  themeQueryOptions,
} from "./content";
import { surveyKeys } from "./surveys";

const id = sampleSurvey.id;

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("reading documents", () => {
  it("reads the definition and its ETag", async () => {
    server.use(definitionHandler({ title: "T" }, '"v7"'));
    const data = await newClient().fetchQuery(definitionQueryOptions(id));
    expect(data).toEqual({ content: { title: "T" }, etag: '"v7"' });
  });

  it("reads the theme and its ETag", async () => {
    server.use(themeHandler({ themeName: "x" }, '"t7"'));
    const data = await newClient().fetchQuery(themeQueryOptions(id));
    expect(data).toEqual({ content: { themeName: "x" }, etag: '"t7"' });
  });

  it("rejects a 200 without an ETag", async () => {
    server.use(definitionHandler({}, null));
    await expect(newClient().fetchQuery(definitionQueryOptions(id))).rejects.toMatchObject({
      problem: { code: "internal-error" },
    });
  });

  it("reads once per open", () => {
    expect(definitionQueryOptions(id)).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      gcTime: 0,
    });
  });
});

describe("saving documents", () => {
  it("sends If-Match and the body and resolves to the new ETag", async () => {
    const seen: SavedContent[] = [];
    server.use(saveDefinitionHandler('"v9"', (saved) => seen.push(saved)));
    await expect(saveDefinition(id, { title: "New" }, '"v8"')).resolves.toBe('"v9"');
    expect(seen).toEqual([{ ifMatch: '"v8"', body: { title: "New" } }]);
  });

  it("saves the theme the same way", async () => {
    const seen: SavedContent[] = [];
    server.use(saveThemeHandler('"t9"', (saved) => seen.push(saved)));
    await expect(saveTheme(id, { themeName: "n" }, '"t8"')).resolves.toBe('"t9"');
    expect(seen).toEqual([{ ifMatch: '"t8"', body: { themeName: "n" } }]);
  });

  it("rejects a 412 with the edit-conflict ApiError", async () => {
    server.use(editConflictHandler("definition"));
    const error = await saveDefinition(id, {}, '"v1"').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("edit-conflict");
  });
});

describe("history", () => {
  it("follows nextCursor", async () => {
    const entry = (at: string) => ({ id: at, at, user: null });
    const requested: (string | null)[] = [];
    server.use(
      historyHandler(
        {
          "": { items: [entry("2026-04-02T10:00:00.000Z")], nextCursor: "c2" },
          c2: { items: [entry("2026-04-01T10:00:00.000Z")], nextCursor: null },
        },
        (url) => requested.push(url.searchParams.get("cursor")),
      ),
    );
    const data = await newClient().fetchInfiniteQuery({
      ...historyInfiniteQueryOptions(id),
      pages: 2,
    });
    expect(data.pages.flatMap((page) => page.items.map((item) => item.at))).toEqual([
      "2026-04-02T10:00:00.000Z",
      "2026-04-01T10:00:00.000Z",
    ]);
    expect(requested).toEqual([null, "c2"]);
  });
});

describe("a history entry", () => {
  it("reads the definition saved in it", async () => {
    server.use(historyEntryHandler({ e1: { title: "Then" } }));
    expect(await newClient().fetchQuery(historyEntryQueryOptions(id, "e1"))).toEqual({
      title: "Then",
    });
  });

  it("rejects an unknown entry with the not-found ApiError", async () => {
    server.use(historyEntryHandler({}));
    const error = await newClient()
      .fetchQuery(historyEntryQueryOptions(id, "e9"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("not-found");
  });
});

describe("markSavedContentStale", () => {
  it("marks the scope's lists and the history stale without refetching", () => {
    const client = newClient();
    const list = surveyKeys.list({ project: "personal", archived: false });
    const other = surveyKeys.list({ project: "other", archived: false });
    const history = contentKeys.history(id);
    for (const key of [list, other, history]) client.setQueryData(key, { pages: [] });
    markSavedContentStale(client, sampleSurvey);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
    expect(client.getQueryState(history)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.isFetching()).toBe(0);
  });
});
