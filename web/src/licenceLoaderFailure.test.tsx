import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import { appConfig, configHandler, server } from "./test/server";

vi.mock("survey-core", () => {
  throw new Error("chunk load failed");
});

describe("SurveyJS licence key when survey-core cannot be loaded", () => {
  it("still renders the home page, warns, and shows no configuration error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(configHandler({ ...appConfig, surveyjsLicenseKey: "key-from-config" }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/"] }));

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("edition: self-hosted")).toBeTruthy();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    warn.mockRestore();
  });
});
