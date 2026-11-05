import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "./navigation";
import type { RunSurveyProps } from "./run/RunSurvey";
import { DetailsTab } from "./results/DetailsTab";
import seedJson from "./sandbox/seed.json";
import type { SandboxSeed } from "./sandbox/seed-types";
import { DEFAULT_SETTINGS } from "./sandbox/settings";
import { createSandboxStore, memoryStorage, type SandboxStore } from "./sandbox/store";
import { createAppRouter } from "./router";
import { currentUserQueryOptions } from "./api/session";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderApp } from "./test/renderApp";
import { sampleSurvey, surveyListPageHandlers } from "./test/server";
import {
  appConfig,
  configHandler,
  currentUser,
  meHandler,
  server,
  unauthenticatedHandler,
} from "./test/server";
import { publishedSurveyHandler, samplePublishedSurvey } from "./test/public-handlers";
import { statsHandler } from "./test/results-handlers";

vi.setConfig({ testTimeout: 15_000 });

// How the sandbox build is tested without building it: the shared files test the mode inline
// (`import.meta.env.MODE === "sandbox"`), which `vi.stubEnv("MODE", ...)` changes at run time.
vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data }: RunSurveyProps) => <p data-testid="fake-survey">{data.survey.name}</p>,
}));
let store: SandboxStore;
vi.mock("./sandbox/start", () => ({ sandboxStore: () => store }));

// What the mock answers for /config: a local directory with passwords.
const sandboxConfig = () => configHandler({ ...appConfig, authMethods: ["password"] });

const DEMO = "This is a demo. Your data stays in this browser, and other visitors don't see it.";

beforeEach(() => {
  vi.stubEnv("MODE", "sandbox");
  store = createSandboxStore({
    storage: memoryStorage(),
    seed: seedJson as unknown as SandboxSeed,
    settings: DEFAULT_SETTINGS,
  });
  vi.mocked(navigateTo).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  document.cookie = "msid=; path=/; max-age=0";
});

describe("the sandbox build", () => {
  it("sends a 401 to sign-in, which shows Pick an account", async () => {
    server.use(sandboxConfig(), unauthenticatedHandler());

    const router = renderApp("/projects?x=1");

    expect(await screen.findByRole("heading", { name: "Pick an account" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toEqual({ returnTo: "/projects?x=1" });
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /@example\.com/ })).toHaveLength(4);
  });

  it("shows the demo banner above a signed-in page", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());

    renderApp("/");

    expect(await screen.findByText(DEMO)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });

  it("shows the banner on the sign-in page", async () => {
    server.use(sandboxConfig(), unauthenticatedHandler());

    renderApp("/sign-in");
    expect(await screen.findByText(DEMO)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source code" })).toBeTruthy();
  });

  it("shows the compact banner on the run page", async () => {
    server.use(configHandler(), publishedSurveyHandler());

    renderApp(`/s/${samplePublishedSurvey.id}`);

    expect(await screen.findByTestId("fake-survey")).toBeTruthy();
    expect(screen.getByText(DEMO)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Source code" })).toBeNull();
  });

  it("clears the session cookie and goes to sign-in on sign-out", async () => {
    document.cookie = `msid=${currentUser.id}; path=/`;
    server.use(
      configHandler(),
      meHandler(),
      ...surveyListPageHandlers(),
      mswHttp.post("*/api/v1/auth/logout", () => HttpResponse.json({ redirectUrl: "/sign-in" })),
    );
    renderApp("/");

    (await screen.findByRole("button", { name: "Sign Out" })).click();

    await waitFor(() => expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/sign-in"));
    expect(document.cookie).not.toContain("msid=");
  });
});

describe("a session that ends in another tab", () => {
  it("sends the next 401 to the account picker, back to this page after", async () => {
    document.cookie = `msid=${currentUser.id}; path=/`;
    server.use(sandboxConfig(), meHandler(), ...surveyListPageHandlers());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/?x=1"] }));
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Sign Out" });

    // What another tab's Reset does: the data is the seed again and the cookie is gone.
    store.reset();
    document.cookie = "msid=; path=/; max-age=0";
    server.use(unauthenticatedHandler());
    await queryClient.fetchQuery(currentUserQueryOptions).catch(() => undefined);

    expect(await screen.findByRole("heading", { name: "Pick an account" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toEqual({ returnTo: "/?project=personal" });
    expect(screen.getAllByRole("button", { name: /@example\.com/ })).toHaveLength(4);
  });
});

describe("the normal build", () => {
  beforeEach(() => vi.stubEnv("MODE", "test"));

  it("shows no demo banner", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());

    renderApp("/");

    expect(await screen.findByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(screen.queryByText(DEMO)).toBeNull();
  });

  it("sends a 401 to the server login when surveyjs.io is the only method", async () => {
    server.use(configHandler(), unauthenticatedHandler());

    renderApp("/");

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());
    expect(vi.mocked(navigateTo).mock.calls[0]![0]).toContain("/api/v1/auth/login");
  });
});

describe("the results Details tab", () => {
  const stats = {
    count: 3,
    firstSubmittedAt: "2026-01-01T00:00:00Z",
    lastSubmittedAt: "2026-01-02T00:00:00Z",
  };
  function renderDetails() {
    server.use(statsHandler(stats));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <DetailsTab survey={sampleSurvey} onReset={async () => {}} />
      </QueryClientProvider>,
    );
  }

  it("has no export links in the sandbox build", async () => {
    renderDetails();

    expect(await screen.findByText("Total responses:")).toBeTruthy();
    expect(screen.queryByText("Download all results as:")).toBeNull();
    expect(screen.queryByRole("link", { name: "JSON" })).toBeNull();
    expect(screen.queryByRole("link", { name: "CSV" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reset Table State" })).toBeTruthy();
  });

  it("still has them in the normal build", async () => {
    vi.stubEnv("MODE", "test");
    renderDetails();

    expect(await screen.findByText("Download all results as:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "JSON" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CSV" })).toBeTruthy();
  });
});
