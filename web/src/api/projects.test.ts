import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./client";
import {
  forgetProject,
  membersQueryOptions,
  projectKeys,
  projectsQueryOptions,
  refreshProjects,
  useAddMember,
  useChangeMemberRole,
  useCreateProject,
  useDeleteProject,
  useRemoveMember,
  useRenameProject,
} from "./projects";
import { surveyKeys } from "./surveys";
import { projectsHandler, sampleProject, server } from "../test/server";
import {
  membersHandler,
  otherMember,
  problemAnswer,
  projectWriteHandlers,
  selfMember,
  type RecordedWrite,
} from "../test/project-handlers";

describe("projects list query", () => {
  it("follows nextCursor across pages and returns one array", async () => {
    const second = {
      ...sampleProject,
      id: "55555555-0000-4000-8000-a00000000002",
      name: "Engineering",
    };
    server.use(
      projectsHandler({
        "": { items: [sampleProject], nextCursor: "page-2" },
        "page-2": { items: [second], nextCursor: null },
      }),
    );

    const projects = await new QueryClient().fetchQuery(projectsQueryOptions);

    expect(projects.map((project) => project.name)).toEqual(["Marketing", "Engineering"]);
  });
});

const personalList = { project: "personal", archived: false } as const;

describe("membersQueryOptions", () => {
  it("follows nextCursor across pages", async () => {
    const seen: URL[] = [];
    server.use(
      mswHttp.get("*/api/v1/projects/:projectId/members", ({ request }) => {
        const url = new URL(request.url);
        seen.push(url);
        return url.searchParams.has("cursor")
          ? HttpResponse.json({ items: [otherMember], nextCursor: null })
          : HttpResponse.json({ items: [selfMember], nextCursor: "c2" });
      }),
    );

    const members = await new QueryClient().fetchQuery(membersQueryOptions("P"));

    expect(members).toEqual([selfMember, otherMember]);
    expect(
      seen.map((url) => [url.searchParams.get("limit"), url.searchParams.get("cursor")]),
    ).toEqual([
      ["200", null],
      ["200", "c2"],
    ]);
  });

  it("answers through the shared members handler", async () => {
    server.use(membersHandler(() => [selfMember]));

    await expect(new QueryClient().fetchQuery(membersQueryOptions("p1"))).resolves.toEqual([
      selfMember,
    ]);
  });

  it("rejects with the ApiError of a 404", async () => {
    server.use(
      mswHttp.get("*/api/v1/projects/:projectId/members", () =>
        HttpResponse.json(problemAnswer(404, "not-found").body as Record<string, unknown>, {
          status: 404,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    );

    const error = await new QueryClient()
      .fetchQuery(membersQueryOptions("P"))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.status).toBe(404);
  });
});

describe("refreshProjects", () => {
  it("invalidates every project entry and no survey list", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(projectKeys.list(), []);
    queryClient.setQueryData(projectKeys.detail("p1"), {});
    queryClient.setQueryData(projectKeys.members("p1"), []);
    queryClient.setQueryData(surveyKeys.list(personalList), {});

    await refreshProjects(queryClient);

    for (const key of [projectKeys.list(), projectKeys.detail("p1"), projectKeys.members("p1")]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(surveyKeys.list(personalList))?.isInvalidated).toBe(false);
  });
});

function seededClient() {
  const queryClient = new QueryClient();
  const keys = [
    projectKeys.list(),
    projectKeys.detail("p1"),
    projectKeys.members("p1"),
    projectKeys.detail("p2"),
    surveyKeys.list({ project: "p1", archived: false }),
    surveyKeys.hasArchived("p1"),
    surveyKeys.list(personalList),
    surveyKeys.hasArchived("personal"),
    surveyKeys.detail("s1"),
    surveyKeys.list({ project: "p2", archived: false }),
  ];
  for (const key of keys) queryClient.setQueryData(key, {});
  return queryClient;
}

describe("forgetProject", () => {
  it("drops the project's queries and refreshes the personal ones after a deletion", async () => {
    const queryClient = seededClient();

    await forgetProject(queryClient, "p1", { deleted: true });

    const state = (key: readonly unknown[]) => queryClient.getQueryState(key);
    expect(state(projectKeys.list())?.isInvalidated).toBe(true);
    for (const key of [
      projectKeys.detail("p1"),
      projectKeys.members("p1"),
      surveyKeys.list({ project: "p1", archived: false }),
      surveyKeys.hasArchived("p1"),
    ]) {
      expect(state(key)).toBeUndefined();
    }
    for (const key of [
      surveyKeys.list(personalList),
      surveyKeys.hasArchived("personal"),
      surveyKeys.detail("s1"),
    ]) {
      expect(state(key)?.isInvalidated).toBe(true);
    }
    expect(state(projectKeys.detail("p2"))?.isInvalidated).toBe(false);
    expect(state(surveyKeys.list({ project: "p2", archived: false }))?.isInvalidated).toBe(false);
  });

  it("leaves the personal entries alone when the user only left", async () => {
    const queryClient = seededClient();

    await forgetProject(queryClient, "p1", { deleted: false });

    for (const key of [
      surveyKeys.list(personalList),
      surveyKeys.hasArchived("personal"),
      surveyKeys.detail("s1"),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });
});

describe("project and member hooks", () => {
  const writes: RecordedWrite[] = [];
  let status = 200;
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  beforeEach(() => {
    writes.length = 0;
    status = 200;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    document.cookie = "msid_csrf=token-1";
    server.use(
      ...projectWriteHandlers(writes, () =>
        status === 409
          ? problemAnswer(409, "last-admin")
          : status === 204
            ? { status: 204 }
            : { status: 200, body: sampleProject },
      ),
    );
  });
  afterEach(() => {
    document.cookie = "msid_csrf=; Max-Age=0";
  });

  const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

  it("creates a project with the CSRF token and refreshes the list", async () => {
    queryClient.setQueryData(projectKeys.list(), []);
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    await result.current.mutateAsync("New");

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/projects",
      csrf: "token-1",
      body: { name: "New" },
    });
    expect(invalidated(projectKeys.list())).toBe(true);
  });

  it("renames as a merge patch", async () => {
    const { result } = renderHook(() => useRenameProject(), { wrapper });

    await result.current.mutateAsync({ projectId: "p1", name: "Renamed" });

    expect(writes[0]).toMatchObject({
      method: "PATCH",
      contentType: "application/merge-patch+json",
      body: { name: "Renamed" },
    });
  });

  it("adds a member as a plain user", async () => {
    const { result } = renderHook(() => useAddMember(), { wrapper });

    await result.current.mutateAsync({ projectId: "p1", email: "x@example.test" });

    expect(writes[0]?.body).toEqual({ email: "x@example.test", role: "user" });
  });

  it("changes a role as a merge patch", async () => {
    const { result } = renderHook(() => useChangeMemberRole(), { wrapper });

    await result.current.mutateAsync({ projectId: "p1", userId: "u1", role: "admin" });

    expect(writes[0]).toMatchObject({
      method: "PATCH",
      contentType: "application/merge-patch+json",
      body: { role: "admin" },
    });
  });

  it("forgets the project when the user removes themselves", async () => {
    status = 204;
    queryClient.setQueryData(projectKeys.members("p1"), []);
    const { result } = renderHook(() => useRemoveMember(), { wrapper });

    await result.current.mutateAsync({ projectId: "p1", userId: "u1", self: true });

    expect(queryClient.getQueryState(projectKeys.members("p1"))).toBeUndefined();
  });

  it("keeps and refreshes the members when another member is removed", async () => {
    status = 204;
    queryClient.setQueryData(projectKeys.members("p1"), []);
    const { result } = renderHook(() => useRemoveMember(), { wrapper });

    await result.current.mutateAsync({ projectId: "p1", userId: "u1", self: false });

    expect(invalidated(projectKeys.members("p1"))).toBe(true);
  });

  it("refreshes the personal list after a deletion", async () => {
    status = 204;
    queryClient.setQueryData(surveyKeys.list(personalList), {});
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    await result.current.mutateAsync("p1");

    expect(invalidated(surveyKeys.list(personalList))).toBe(true);
  });

  it("rejects a last-admin answer and leaves the cache as it was", async () => {
    status = 409;
    queryClient.setQueryData(projectKeys.members("p1"), []);
    const { result } = renderHook(() => useRemoveMember(), { wrapper });

    const error = await result.current
      .mutateAsync({ projectId: "p1", userId: "u1", self: true })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("last-admin");
    expect(invalidated(projectKeys.members("p1"))).toBe(false);
  });
});
