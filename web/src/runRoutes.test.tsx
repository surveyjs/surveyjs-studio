import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID_KEY, perSurveyClientId } from "./run/clientId";
import type { RunSurveyProps } from "./run/RunSurvey";
import {
  limitedPublishedSurvey,
  publicProblemHandler,
  publishedSurveyHandler,
  samplePublishedSurvey,
} from "./test/public-handlers";
import { renderApp } from "./test/renderApp";
import { appConfig, configHandler, server } from "./test/server";

// jsdom does not run the Form Library here: the fake shows what the page passes.
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data, kind, search, maxFileBytes }: RunSurveyProps) => (
    <pre data-testid="fake-survey">
      {JSON.stringify({ name: data.survey.name, kind, search, maxFileBytes })}
    </pre>
  ),
}));

const surveyId = samplePublishedSurvey.id;
const shown = async () =>
  JSON.parse((await screen.findByTestId("fake-survey")).textContent!) as unknown;

/** Records the path of every request to the API. */
function recordRequests() {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on("request:start", listener);
  return { paths, stop: () => server.events.removeListener("request:start", listener) };
}

afterEach(() => {
  window.localStorage.removeItem(CLIENT_ID_KEY);
});

describe("the run page", () => {
  it("runs a published survey", async () => {
    server.use(configHandler(), publishedSurveyHandler());

    renderApp(`/s/${surveyId}`);

    expect(await shown()).toEqual({
      name: "Customer feedback",
      kind: "running",
      search: {},
      maxFileBytes: appConfig.limits.maxFileBytes,
    });
    expect(document.title).toBe("Customer feedback");
  });

  it("shows the completed state when this browser has completed a limited survey", async () => {
    window.localStorage.setItem(CLIENT_ID_KEY, "browser-1");
    // The page sends this survey's id, derived from the browser id, never the browser id itself.
    const completedFor = await perSurveyClientId("browser-1", surveyId);
    server.use(configHandler(), publishedSurveyHandler(limitedPublishedSurvey, { completedFor }));

    renderApp(`/s/${surveyId}`);

    expect(await shown()).toMatchObject({ kind: "completed" });
  });

  it("names the page Survey when the survey has no name", async () => {
    server.use(configHandler(), publishedSurveyHandler({ ...samplePublishedSurvey, name: "" }));

    renderApp(`/s/${surveyId}`);

    await shown();
    expect(document.title).toBe("Survey");
  });

  it("shows the not-available page for a survey that is not available", async () => {
    server.use(
      configHandler(),
      publicProblemHandler("get", "/public/surveys/:surveyId", 404, "survey-not-available"),
    );

    renderApp(`/s/${surveyId}`);

    expect(
      await screen.findByRole("heading", { name: "This survey is not currently available." }),
    ).toBeTruthy();
    expect(document.title).toBe("Survey not available");
    expect(screen.queryByTestId("fake-survey")).toBeNull();
  });

  it("offers to try again when the survey could not be loaded", async () => {
    server.use(
      configHandler(),
      publicProblemHandler("get", "/public/surveys/:surveyId", 500, "internal-error"),
    );
    const requests = recordRequests();
    try {
      renderApp(`/s/${surveyId}`);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "The survey could not be loaded. Check your connection and try again.",
      );
      server.use(publishedSurveyHandler());
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await shown()).toMatchObject({ name: "Customer feedback", kind: "running" });
      expect(requests.paths.filter((path) => path.startsWith("/api/v1/public/"))).toEqual([
        `/api/v1/public/surveys/${surveyId}`,
        `/api/v1/public/surveys/${surveyId}`,
      ]);
    } finally {
      requests.stop();
    }
  });
});
