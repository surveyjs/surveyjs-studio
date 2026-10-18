import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { resultKeys } from "./results";
import {
  addCreatedSurvey,
  applyUpdatedSurvey,
  hasArchivedQueryOptions,
  removeDeletedSurvey,
  surveyKeys,
  surveyListQueryOptions,
  useCloneSurvey,
  useCreateSurvey,
  useDeleteSurvey,
  useUpdateSurvey,
  type Survey,
  type SurveyPage,
} from "./surveys";
import {
  cloneSurveyHandler,
  createSurveyHandler,
  deleteSurveyHandler,
  sampleSurvey,
  server,
  surveyActionProblemHandler,
  surveysHandler,
  updateSurveyHandler,
} from "../test/server";

const existing: Survey = {
  ...sampleSurvey,
  id: "22222222-0000-4000-8000-000000000001",
  name: "Existing",
};
const created: Survey = {
  ...sampleSurvey,
  id: "22222222-0000-4000-8000-000000000002",
  name: "New Survey 1",
};
const projectId = "55555555-0000-4000-8000-a00000000001";

const data = (...items: Survey[]): InfiniteData<SurveyPage, string | null> => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

const personalActive = surveyKeys.list({ project: "personal", archived: false });
const personalArchived = surveyKeys.list({ project: "personal", archived: true });
const projectActive = surveyKeys.list({ project: projectId, archived: false });

describe("addCreatedSurvey", () => {
  it("puts a personal survey first, sets the detail and invalidates only the personal lists", () => {
    const client = new QueryClient();
    client.setQueryData(personalActive, data(existing));
    client.setQueryData(personalArchived, data());
    client.setQueryData(projectActive, data(existing));
    client.setQueryData(surveyKeys.hasArchived("personal"), true);

    addCreatedSurvey(client, created);

    expect(client.getQueryData(personalActive)).toEqual(data(created, existing));
    expect(client.getQueryData(surveyKeys.detail(created.id))).toEqual(created);
    expect(client.getQueryState(personalActive)?.isInvalidated).toBe(true);
    expect(client.getQueryState(personalArchived)?.isInvalidated).toBe(true);
    expect(client.getQueryData(personalArchived)).toEqual(data());
    expect(client.getQueryData(projectActive)).toEqual(data(existing));
    expect(client.getQueryState(projectActive)?.isInvalidated).toBe(false);
    expect(client.getQueryData(surveyKeys.hasArchived("personal"))).toBe(true);
    expect(client.getQueryState(surveyKeys.hasArchived("personal"))?.isInvalidated).toBe(false);
  });

  it("puts a project survey in that project's list only", () => {
    const client = new QueryClient();
    client.setQueryData(personalActive, data(existing));
    client.setQueryData(projectActive, data(existing));
    const inProject = { ...created, projectId };

    addCreatedSurvey(client, inProject);

    expect(client.getQueryData(projectActive)).toEqual(data(inProject, existing));
    expect(client.getQueryData(personalActive)).toEqual(data(existing));
    expect(client.getQueryState(personalActive)?.isInvalidated).toBe(false);
  });

  it("only sets the detail when no list is cached", () => {
    const client = new QueryClient();

    addCreatedSurvey(client, created);

    expect(client.getQueryData(surveyKeys.detail(created.id))).toEqual(created);
    expect(client.getQueryData(personalActive)).toBeUndefined();
  });

  it("does not add the survey twice", () => {
    const client = new QueryClient();
    client.setQueryData(personalActive, data(existing));

    addCreatedSurvey(client, created);
    addCreatedSurvey(client, created);

    expect(client.getQueryData(personalActive)).toEqual(data(created, existing));
  });
});

describe("survey list query", () => {
  it("requests 50 per page and passes nextCursor as cursor", async () => {
    const urls: URL[] = [];
    server.use(
      surveysHandler(
        {
          "": { items: [existing], nextCursor: "c2" },
          c2: { items: [created], nextCursor: null },
        },
        (url) => urls.push(url),
      ),
    );
    const client = new QueryClient();
    const options = surveyListQueryOptions({ project: "personal", archived: true });

    await client.fetchInfiniteQuery({ ...options, pages: 2 });

    expect(urls.map((url) => url.search)).toEqual([
      "?project=personal&archived=true&limit=50",
      "?project=personal&archived=true&limit=50&cursor=c2",
    ]);
    expect(client.getQueryData(options.queryKey)?.pages.flatMap((page) => page.items)).toEqual([
      existing,
      created,
    ]);
  });
});

describe("has-archived query", () => {
  it("asks for one archived survey", async () => {
    const urls: URL[] = [];
    server.use(
      surveysHandler({ "": { items: [existing], nextCursor: null } }, (url) => urls.push(url)),
    );
    const client = new QueryClient();

    expect(await client.fetchQuery(hasArchivedQueryOptions("personal"))).toBe(true);
    expect(urls[0]?.search).toBe("?project=personal&archived=true&limit=1");
  });
});

describe("useCreateSurvey", () => {
  const render = () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(() => useCreateSurvey(), { wrapper }) };
  };

  it("sends projectId null for personal and refreshes the cache", async () => {
    const bodies: unknown[] = [];
    server.use(createSurveyHandler(created, (body) => bodies.push(body)));
    const { client, result } = render();
    client.setQueryData(personalActive, data(existing));

    result.current.mutate("personal");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([{ projectId: null }]);
    expect(client.getQueryData(personalActive)).toEqual(data(created, existing));
  });

  it("sends the project id for a project", async () => {
    const bodies: unknown[] = [];
    server.use(createSurveyHandler(created, (body) => bodies.push(body)));
    const { result } = render();

    result.current.mutate(projectId);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([{ projectId }]);
  });
});

const other: Survey = { ...existing, id: "22222222-0000-4000-8000-000000000003", name: "Other" };
const projectArchived = surveyKeys.list({ project: projectId, archived: true });
const seeded = () => {
  const client = new QueryClient();
  client.setQueryData(personalActive, data(existing, other));
  client.setQueryData(personalArchived, data());
  client.setQueryData(projectActive, data());
  client.setQueryData(projectArchived, data());
  client.setQueryData(surveyKeys.detail(existing.id), existing);
  client.setQueryData(surveyKeys.hasArchived("personal"), false);
  client.setQueryData(surveyKeys.hasArchived(projectId), false);
  return client;
};
const stale = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated;

describe("applyUpdatedSurvey", () => {
  it("renames in place and updates the detail", () => {
    const client = seeded();
    const renamed = { ...existing, name: "Renamed" };

    applyUpdatedSurvey(client, existing, renamed);

    expect(client.getQueryData(personalActive)).toEqual(data(renamed, other));
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toEqual(renamed);
    expect(stale(client, personalActive)).toBe(true);
    expect(stale(client, personalArchived)).toBe(true);
    expect(stale(client, surveyKeys.hasArchived("personal"))).toBe(false);
  });

  it("archive leaves the active list and refreshes has-archived", () => {
    const client = seeded();
    const archived = { ...existing, archived: true };

    applyUpdatedSurvey(client, existing, archived);

    expect(client.getQueryData(personalActive)).toEqual(data(other));
    expect(client.getQueryData(personalArchived)).toEqual(data());
    expect(stale(client, personalArchived)).toBe(true);
    expect(stale(client, surveyKeys.hasArchived("personal"))).toBe(true);
    expect(stale(client, surveyKeys.hasArchived(projectId))).toBe(false);
  });

  it("restore is the reverse", () => {
    const client = seeded();
    const archived = { ...existing, archived: true };
    client.setQueryData(personalActive, data(other));
    client.setQueryData(personalArchived, data(archived));
    const restored = { ...archived, archived: false };

    applyUpdatedSurvey(client, archived, restored);

    expect(client.getQueryData(personalArchived)).toEqual(data());
    expect(client.getQueryData(personalActive)).toEqual(data(other));
    expect(stale(client, personalActive)).toBe(true);
    expect(stale(client, surveyKeys.hasArchived("personal"))).toBe(true);
  });

  it("move leaves the source lists and refreshes both scopes", () => {
    const client = seeded();
    const moved = { ...existing, projectId };

    applyUpdatedSurvey(client, existing, moved);

    expect(client.getQueryData(personalActive)).toEqual(data(other));
    expect(client.getQueryData(projectActive)).toEqual(data());
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toEqual(moved);
    for (const key of [personalActive, personalArchived, projectActive, projectArchived]) {
      expect(stale(client, key)).toBe(true);
    }
    expect(stale(client, surveyKeys.hasArchived("personal"))).toBe(true);
    expect(stale(client, surveyKeys.hasArchived(projectId))).toBe(true);
  });

  it("leaves other scopes untouched and not invalidated", () => {
    const client = seeded();
    client.setQueryData(projectActive, data(other));

    applyUpdatedSurvey(client, existing, { ...existing, name: "Renamed" });

    expect(client.getQueryData(projectActive)).toEqual(data(other));
    expect(stale(client, projectActive)).toBe(false);
    expect(stale(client, projectArchived)).toBe(false);
    expect(stale(client, surveyKeys.hasArchived(projectId))).toBe(false);
  });
});

describe("removeDeletedSurvey", () => {
  it("removes the survey everywhere and refreshes its scope", () => {
    const client = seeded();
    const archived = { ...existing, archived: true };
    client.setQueryData(personalArchived, data(archived));

    removeDeletedSurvey(client, archived);

    expect(client.getQueryData(personalArchived)).toEqual(data());
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toBeUndefined();
    expect(stale(client, personalActive)).toBe(true);
    expect(stale(client, personalArchived)).toBe(true);
    expect(stale(client, surveyKeys.hasArchived("personal"))).toBe(true);
    expect(stale(client, projectActive)).toBe(false);
    expect(stale(client, surveyKeys.hasArchived(projectId))).toBe(false);
  });
});

describe("survey action hooks", () => {
  const render = <T,>(hook: () => T) => {
    const client = seeded();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(hook, { wrapper }) };
  };

  it("useUpdateSurvey sends a merge patch and applies the result", async () => {
    const seen: { body: unknown; type: string | null }[] = [];
    const renamed = { ...existing, name: "Renamed" };
    server.use(updateSurveyHandler(renamed, (body, type) => seen.push({ body, type })));
    const { client, result } = render(useUpdateSurvey);

    result.current.mutate({ survey: existing, patch: { name: "Renamed" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ body: { name: "Renamed" }, type: "application/merge-patch+json" }]);
    expect(client.getQueryData(personalActive)).toEqual(data(renamed, other));
  });

  it("useUpdateSurvey changes a setting without touching the results caches (R17)", async () => {
    const seen: unknown[] = [];
    const answer = { ...existing, settings: { ...existing.settings, storeRespondentIp: true } };
    server.use(updateSurveyHandler(answer, (body) => seen.push(body)));
    const { client, result } = render(useUpdateSurvey);
    client.setQueryData(resultKeys.all(existing.id), []);
    client.setQueryData(resultKeys.stats(existing.id), {
      count: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });

    result.current.mutate({
      survey: existing,
      patch: { settings: { storeRespondentIp: true } },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ settings: { storeRespondentIp: true } }]);
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toEqual(answer);
    expect(stale(client, resultKeys.all(existing.id))).toBe(false);
    expect(stale(client, resultKeys.stats(existing.id))).toBe(false);
  });

  it("useUpdateSurvey ends in ApiError and leaves the cache on a Problem", async () => {
    server.use(surveyActionProblemHandler("patch"));
    const { client, result } = render(useUpdateSurvey);

    result.current.mutate({ survey: existing, patch: { archived: true } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(client.getQueryData(personalActive)).toEqual(data(existing, other));
    expect(stale(client, personalActive)).toBe(false);
  });

  it("useCloneSurvey posts without a body and adds the copy", async () => {
    const requests: Request[] = [];
    server.use(cloneSurveyHandler(created, (request) => requests.push(request)));
    const { client, result } = render(useCloneSurvey);

    result.current.mutate(existing);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(`/api/v1/surveys/${existing.id}/clones`);
    expect(await requests[0]?.text()).toBe("");
    expect(client.getQueryData(personalActive)).toEqual(data(created, existing, other));
  });

  it("useCloneSurvey ends in ApiError and leaves the cache on a Problem", async () => {
    server.use(surveyActionProblemHandler("post"));
    const { client, result } = render(useCloneSurvey);

    result.current.mutate(existing);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(client.getQueryData(personalActive)).toEqual(data(existing, other));
  });

  it("useDeleteSurvey sends DELETE and removes the survey", async () => {
    const requests: Request[] = [];
    server.use(deleteSurveyHandler((request) => requests.push(request)));
    const { client, result } = render(useDeleteSurvey);

    result.current.mutate(existing);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]?.method).toBe("DELETE");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(`/api/v1/surveys/${existing.id}`);
    expect(client.getQueryData(personalActive)).toEqual(data(other));
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toBeUndefined();
  });

  it("useDeleteSurvey ends in ApiError and leaves the cache on a Problem", async () => {
    server.use(surveyActionProblemHandler("delete"));
    const { client, result } = render(useDeleteSurvey);

    result.current.mutate(existing);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(client.getQueryData(personalActive)).toEqual(data(existing, other));
    expect(client.getQueryData(surveyKeys.detail(existing.id))).toEqual(existing);
  });
});
