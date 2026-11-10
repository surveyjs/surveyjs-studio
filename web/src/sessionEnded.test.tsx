import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { client, toApiError } from "./api/client";
import { navigateTo } from "./navigation";
import { createAppRouter } from "./router";
import type { RunSurveyProps } from "./run/RunSurvey";
import { publishedSurveyHandler, samplePublishedSurvey } from "./test/public-handlers";
import {
  appConfig,
  configHandler,
  meHandler,
  server,
  surveyListPageHandlers,
  unauthenticatedHandler,
} from "./test/server";

// Any request of a signed-in page that answers 401 sends the page to sign-in (router.ts).
vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data }: RunSurveyProps) => <p data-testid="fake-survey">{data.survey.name}</p>,
}));

const passwordConfig = { ...appConfig, authMethods: ["password" as const] };

const signedOut = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Sign in required", status: 401, code: "unauthenticated" },
    { status: 401, headers: { "Content-Type": "application/problem+json" } },
  );

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

/** A query of the page whose request answers 401, as any page's would. */
const failingQuery = (queryClient: QueryClient) =>
  queryClient
    .fetchQuery({
      queryKey: ["a page's data"],
      queryFn: async () => {
        const { error, response } = await client.GET("/surveys", {});
        throw toApiError(error, response);
      },
    })
    .catch(() => undefined);

/** A write of the page whose request answers 401. */
const failingMutation = (queryClient: QueryClient) =>
  queryClient
    .getMutationCache()
    .build(queryClient, {
      mutationFn: async () => {
        const { error, response } = await client.GET("/surveys", {});
        throw toApiError(error, response);
      },
    })
    .execute(undefined)
    .catch(() => undefined);

beforeEach(() => {
  vi.mocked(navigateTo).mockClear();
});

describe("a session that ends while a signed-in page is open", () => {
  it.each([
    ["a query", failingQuery],
    ["a write", failingMutation],
  ])("goes to sign-in on %s's 401, back to the page after", async (_name, fail) => {
    server.use(configHandler(passwordConfig), meHandler(), ...surveyListPageHandlers());
    const { router, queryClient } = renderAt("/?x=1");
    await screen.findByRole("button", { name: "Sign Out" });
    const before = router.state.location.href;

    // Signed out in another tab, disabled or reset by an admin: every request answers 401 now.
    server.use(unauthenticatedHandler(), mswHttp.get("*/api/v1/surveys", signedOut));
    await fail(queryClient);

    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toEqual({ returnTo: before });
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    // The cached user is gone: the guard asks again after the sign-in.
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });

  it("leaves for the server's login when surveyjs.io is the only method", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());
    const { router, queryClient } = renderAt("/?x=1");
    await screen.findByRole("button", { name: "Sign Out" });
    const before = router.state.location.href;

    server.use(unauthenticatedHandler(), mswHttp.get("*/api/v1/surveys", signedOut));
    await failingQuery(queryClient);

    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(
        `/api/v1/auth/login?returnTo=${encodeURIComponent(before)}`,
      ),
    );
  });

  it("leaves a public page alone: the run page stays", async () => {
    server.use(configHandler(passwordConfig), unauthenticatedHandler(), publishedSurveyHandler());
    const { router, queryClient } = renderAt(`/s/${samplePublishedSurvey.id}`);
    expect(await screen.findByTestId("fake-survey")).toBeTruthy();

    server.use(mswHttp.get("*/api/v1/surveys", signedOut));
    await failingQuery(queryClient);

    // A moment for a redirect that must not come.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe(`/s/${samplePublishedSurvey.id}`);
    expect(screen.getByTestId("fake-survey")).toBeTruthy();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
