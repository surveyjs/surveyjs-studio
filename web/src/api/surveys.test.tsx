import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  addCreatedSurvey,
  hasArchivedQueryOptions,
  surveyKeys,
  surveyListQueryOptions,
  useCreateSurvey,
  type Survey,
  type SurveyPage,
} from "./surveys";
import { createSurveyHandler, sampleSurvey, server, surveysHandler } from "../test/server";

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
