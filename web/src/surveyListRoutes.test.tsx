import { cleanup, screen } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it } from "vitest";
import { lastProject, rememberProject } from "./surveyList/lastProject";
import { renderApp } from "./test/renderApp";
import {
  configHandler,
  currentUser,
  meHandler,
  projectsHandler,
  sampleProject,
  sampleSurvey,
  server,
  surveysHandler,
} from "./test/server";

const marketing = sampleProject;
const UNKNOWN_PROJECT = "99999999-9999-4999-8999-999999999999";

/** My Surveys with one survey in every list, Marketing among the user's projects. */
function useListHandlers() {
  server.use(
    configHandler(),
    meHandler(),
    surveysHandler({ "": { items: [sampleSurvey], nextCursor: null } }),
    projectsHandler({ "": { items: [marketing], nextCursor: null } }),
  );
}

describe("the remembered list", () => {
  it("plain / opens Personal Surveys, by name, when nothing is remembered", async () => {
    useListHandlers();
    const router = renderApp("/");

    await screen.findByText(sampleSurvey.name);
    expect(router.state.location.href).toBe("/?project=personal");
    expect(lastProject(currentUser.id)).toBe("personal");
  });

  it("plain / opens the list the user looked at last, on the next page load, and keeps archived", async () => {
    useListHandlers();
    renderApp(`/?project=${marketing.id}`);
    await screen.findByText(sampleSurvey.name);
    expect(lastProject(currentUser.id)).toBe(marketing.id);

    // A new page load: a fresh app on the same storage.
    cleanup();
    let router = renderApp("/");
    await screen.findByText(sampleSurvey.name);
    expect(router.state.location.href).toBe(`/?project=${marketing.id}`);

    cleanup();
    router = renderApp("/?archived=true");
    await screen.findByText(sampleSurvey.name);
    expect(router.state.location.href).toBe(`/?project=${marketing.id}&archived=true`);
  });

  it("is another user's own: their project does not open for this user", async () => {
    useListHandlers();
    rememberProject("11111111-0000-4000-8000-a00000000003", marketing.id);
    const router = renderApp("/");

    await screen.findByText(sampleSurvey.name);
    expect(router.state.location.href).toBe("/?project=personal");
  });

  it("falls back to Personal Surveys, and is forgotten, when the user can no longer open it", async () => {
    useListHandlers();
    server.use(
      mswHttp.get("*/api/v1/surveys", ({ request }) =>
        new URL(request.url).searchParams.get("project") === UNKNOWN_PROJECT
          ? HttpResponse.json(
              { type: "about:blank", title: "Not found", status: 404, code: "not-found" },
              { status: 404, headers: { "Content-Type": "application/problem+json" } },
            )
          : HttpResponse.json({ items: [sampleSurvey], nextCursor: null }),
      ),
    );
    rememberProject(currentUser.id, UNKNOWN_PROJECT);
    const router = renderApp("/");

    await screen.findByText(sampleSurvey.name);
    expect(router.state.location.href).toBe("/?project=personal");
    expect(lastProject(currentUser.id)).toBe("personal");
  });
});
