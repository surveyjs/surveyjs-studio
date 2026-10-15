import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import { appConfig, configHandler, meHandler, server } from "./test/server";

const setLicenseKey = vi.fn();
vi.mock("survey-core", () => ({ setLicenseKey }));

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/"] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("SurveyJS licence key", () => {
  it("is passed from /config to survey-core without blocking the page", async () => {
    server.use(meHandler(), configHandler({ ...appConfig, surveyjsLicenseKey: "key-from-config" }));

    renderApp();

    expect(await screen.findByText("edition: self-hosted")).toBeTruthy();
    await waitFor(() => expect(setLicenseKey).toHaveBeenCalledExactlyOnceWith("key-from-config"));
  });
});
