import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./test/renderApp";
import { configHandler, server } from "./test/server";

/** Records the path of every request to the API. */
function recordRequests() {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on("request:start", listener);
  return { paths, stop: () => server.events.removeListener("request:start", listener) };
}

// surveyjs.io's addresses are not routes of the app (R22): no redirect, the root's not-found page.
describe("the not-found page", () => {
  it.each([
    ["/published", "?id=22222222-0000-4000-8000-a00000000004&q1=Ann"],
    ["/Service/EditSurvey/22222222-0000-4000-8000-a00000000001", ""],
  ])("shows at %s%s, without a redirect", async (pathname, search) => {
    server.use(configHandler());
    const requests = recordRequests();
    try {
      const router = renderApp(`${pathname}${search}`);

      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
      expect(screen.getByText("This page doesn't exist or has moved.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Go to My Surveys" }).getAttribute("href")).toBe("/");
      expect(router.state.location.pathname).toBe(pathname);
      expect(router.state.location.searchStr).toBe(search);
      await waitFor(() => expect(requests.paths).toContain("/api/v1/config"));
      expect(requests.paths.filter((path) => path.startsWith("/api/v1/public/"))).toEqual([]);
    } finally {
      requests.stop();
    }
  });
});
