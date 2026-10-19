import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "./navigation";
import type { RunSurveyProps } from "./run/RunSurvey";
import { createAppRouter } from "./router";
import {
  appConfig,
  configHandler,
  currentUser,
  meHandler,
  problemHandler,
  sampleSurvey,
  server,
  surveyHandler,
  surveyListPageHandlers,
  unauthenticatedHandler,
} from "./test/server";
import { publishedSurveyHandler, samplePublishedSurvey } from "./test/public-handlers";

vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));
// jsdom does not run the Form Library here (src/runRoutes.test.tsx tests the run page).
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data }: RunSurveyProps) => <p data-testid="fake-survey">{data.survey.name}</p>,
}));

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(navigateTo).mockClear();
  // Every signed-in test lands on My Surveys, which loads surveys and projects.
  server.use(...surveyListPageHandlers());
});

describe("private route guard", () => {
  it("sends a signed-out visitor to sign-in with the current location as returnTo", async () => {
    server.use(configHandler(), unauthenticatedHandler());

    renderAt("/?tab=1#top");

    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledExactlyOnceWith(
        `/api/v1/auth/login?returnTo=${encodeURIComponent("/?tab=1#top")}`,
      ),
    );
    expect(screen.queryByText("My Surveys", { selector: "h1" })).toBeNull();
  });

  it("renders the page with the signed-in user", async () => {
    server.use(configHandler(), meHandler());

    renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "My Surveys" })).toBeTruthy();
    expect(screen.getByText("Olivia Owner")).toBeTruthy();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("shows the error, not a redirect, when /me fails with something other than 401", async () => {
    server.use(
      configHandler(),
      mswHttp.get("*/api/v1/me", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Boom", status: 500, code: "internal-error" },
          { status: 500, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );

    renderAt("/");

    expect((await screen.findByRole("alert")).textContent).toContain("Boom");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("still shows the config error in the plain frame", async () => {
    server.use(meHandler(), problemHandler(500, "internal-error", "Config broke"));

    renderAt("/");

    expect((await screen.findByRole("alert")).textContent).toContain("Config broke");
  });
});

describe("shell in the private layout", () => {
  it("shows account notices and the links from /config", async () => {
    server.use(
      configHandler({ ...appConfig, links: { Account: "https://example.test/account" } }),
      meHandler({
        ...currentUser,
        notices: [{ code: "license-expired", message: "Your licence has expired." }],
      }),
    );

    renderAt("/");

    expect((await screen.findByRole("status")).textContent).toContain("Your licence has expired.");
    expect(screen.getByRole("link", { name: "Account" }).getAttribute("href")).toBe(
      "https://example.test/account",
    );
  });

  it("signs out: posts logout with the CSRF token, clears the session, then navigates", async () => {
    document.cookie = "msid_csrf=csrf-value";
    let csrf: string | null = null;
    server.use(
      configHandler(),
      meHandler(),
      mswHttp.post("*/api/v1/auth/logout", ({ request }) => {
        csrf = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({ redirectUrl: "https://auth.example.test/logout" });
      }),
    );
    renderAt("/");

    (await screen.findByRole("button", { name: "Sign Out" })).click();

    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledExactlyOnceWith("https://auth.example.test/logout"),
    );
    expect(csrf).toBe("csrf-value");
    document.cookie = "msid_csrf=; Max-Age=0";
  });

  it("after the session expired, still signs out at the identity provider", async () => {
    // The browser dropped msid and msid_csrf, but /me is still cached: no CSRF token is sent,
    // and the server answers with the provider's end-session URL anyway.
    let csrf: string | null = "unset";
    server.use(
      configHandler(),
      meHandler(),
      mswHttp.post("*/api/v1/auth/logout", ({ request }) => {
        csrf = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({ redirectUrl: "https://auth.example.test/logout" });
      }),
    );
    renderAt("/");

    (await screen.findByRole("button", { name: "Sign Out" })).click();

    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledExactlyOnceWith("https://auth.example.test/logout"),
    );
    expect(csrf).toBeNull();
  });

  it("shows an error and stays put when logout fails", async () => {
    server.use(configHandler(), meHandler(), logoutHandler(500, "internal-error", "Boom"));
    renderAt("/");

    (await screen.findByRole("button", { name: "Sign Out" })).click();

    expect((await screen.findByRole("alert")).textContent).toContain("Could not sign out");
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign Out" }).hasAttribute("disabled")).toBe(false);
  });

  it("sends one logout request when Sign Out is clicked twice", async () => {
    let requests = 0;
    server.use(
      configHandler(),
      meHandler(),
      mswHttp.post("*/api/v1/auth/logout", async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json({ redirectUrl: "https://auth.example.test/logout" });
      }),
    );
    renderAt("/");

    const button = await screen.findByRole("button", { name: "Sign Out" });
    button.click();
    button.click();

    await waitFor(() => expect(navigateTo).toHaveBeenCalledTimes(1));
    expect(requests).toBe(1);
  });
});

function logoutHandler(status: number, code: string, title: string) {
  return mswHttp.post("*/api/v1/auth/logout", () =>
    HttpResponse.json(
      { type: `https://my-surveys.surveyjs.io/problems/${code}`, title, status, code },
      { status, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}

describe("survey placeholder routes", () => {
  it.each([["results", "Survey results arrive in a later version."]])(
    "/surveys/<id>/%s shows the survey name and its text",
    async (page, text) => {
      server.use(configHandler(), meHandler(), surveyHandler());

      renderAt(`/surveys/${sampleSurvey.id}/${page}`);

      expect(
        await screen.findByRole("heading", { level: 1, name: sampleSurvey.name }),
      ).toBeTruthy();
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Back to My Surveys" })).toBeTruthy();
    },
  );

  it.each(["results", "history"])(
    "/surveys/<unknown>/%s says the survey is not available",
    async (page) => {
      server.use(configHandler(), meHandler(), surveyHandler());

      renderAt(`/surveys/22222222-0000-4000-8000-000000000002/${page}`);

      expect(await screen.findByText("This survey is not available.")).toBeTruthy();
    },
  );

  it.each(["results", "history"])(
    "/surveys/<id>/%s sends a signed-out visitor to sign-in",
    async (page) => {
      server.use(configHandler(), unauthenticatedHandler());
      const path = `/surveys/${sampleSurvey.id}/${page}`;

      renderAt(path);

      await waitFor(() =>
        expect(navigateTo).toHaveBeenCalledExactlyOnceWith(
          `/api/v1/auth/login?returnTo=${encodeURIComponent(path)}`,
        ),
      );
    },
  );
});

describe("public run route", () => {
  it("/s/<id> renders without a session, reading only /config and the published survey", async () => {
    server.use(configHandler(), publishedSurveyHandler());
    const paths: string[] = [];
    const record = ({ request }: { request: Request }) => {
      paths.push(new URL(request.url).pathname);
    };
    server.events.on("request:start", record);
    try {
      renderAt(`/s/${samplePublishedSurvey.id}`);

      expect((await screen.findByTestId("fake-survey")).textContent).toBe("Customer feedback");
      expect(paths).toEqual([
        "/api/v1/config",
        `/api/v1/public/surveys/${samplePublishedSurvey.id}`,
      ]);
      expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
      expect(navigateTo).not.toHaveBeenCalled();
    } finally {
      server.events.removeListener("request:start", record);
    }
  });
});
