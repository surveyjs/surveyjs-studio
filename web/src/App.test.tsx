import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router";
import { appConfig, configHandler, problemHandler, server } from "./test/server";

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
  it("shows the edition and shell from /config inside the shell", async () => {
    server.use(configHandler());

    renderApp();

    expect(await screen.findByText("edition: self-hosted")).toBeTruthy();
    expect(screen.getByText("shell: surveyjs-site")).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("My Surveys");
  });

  it("shows an error with a retry button when config fails to load, and recovers on retry", async () => {
    server.use(problemHandler(500, "internal-error", "Internal error"));
    renderApp();
    expect(await screen.findByRole("alert")).toBeTruthy();

    server.use(configHandler({ ...appConfig, edition: "hosted" }));
    screen.getByRole("button", { name: "Retry" }).click();

    expect(await screen.findByText("edition: hosted")).toBeTruthy();
  });
});
