import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router";
import {
  appConfig,
  configHandler,
  meHandler,
  problemHandler,
  sampleSurvey,
  server,
  surveyListPageHandlers,
} from "./test/server";

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/"] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("home page", () => {
  it("shows the My Surveys list inside the shell", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());

    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "My Surveys" })).toBeTruthy();
    expect(screen.getByText(sampleSurvey.name)).toBeTruthy();
    // The shell's header (the page's own <header> is inside the article).
    expect(screen.getByText("Olivia Owner").closest("header")?.textContent).toContain("My Surveys");
  });

  it("shows an error with a retry button when config fails to load, and recovers on retry", async () => {
    server.use(
      meHandler(),
      ...surveyListPageHandlers(),
      problemHandler(500, "internal-error", "Internal error"),
    );
    renderApp();
    expect(await screen.findByRole("alert")).toBeTruthy();

    server.use(configHandler({ ...appConfig, edition: "hosted" }));
    screen.getByRole("button", { name: "Retry" }).click();

    expect(await screen.findByText(sampleSurvey.name)).toBeTruthy();
  });
});
