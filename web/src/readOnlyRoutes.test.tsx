import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { definitionHandler, themeHandler } from "./test/content-handlers";
import { publishedSurveyHandler, samplePublishedSurvey } from "./test/public-handlers";
import { renderApp } from "./test/renderApp";
import {
  appConfig,
  configHandler,
  meHandler,
  sampleSurvey,
  server,
  surveyHandler,
  surveyListPageHandlers,
} from "./test/server";
import type { RunSurveyProps } from "./run/RunSurvey";
import type { SurveyEditorProps } from "./editor/SurveyEditor";

const editor = vi.hoisted(() => ({ props: null as SurveyEditorProps | null }));
vi.mock("./editor/SurveyEditor", () => ({
  SurveyEditor: (props: SurveyEditorProps) => {
    editor.props = props;
    return <div data-testid="fake-creator" />;
  },
}));
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data }: RunSurveyProps) => <p data-testid="fake-survey">{data.survey.name}</p>,
}));

const TEXT = "My Surveys is read-only at the moment. Changes cannot be saved.";
const readOnlyConfig = { ...appConfig, readOnly: true };
const banner = () => screen.queryByText(TEXT);

describe("the read-only banner", () => {
  it("shows on the survey list", async () => {
    server.use(configHandler(readOnlyConfig), meHandler(), ...surveyListPageHandlers());
    renderApp("/");

    expect((await screen.findByText(TEXT)).closest("[role=status]")).not.toBeNull();
  });

  it("shows on the run page", async () => {
    server.use(configHandler(readOnlyConfig), publishedSurveyHandler());
    renderApp(`/s/${samplePublishedSurvey.id}`);

    await screen.findByTestId("fake-survey");
    expect(banner()).not.toBeNull();
  });

  it("shows nothing when the server is not read-only", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());
    renderApp("/");

    await screen.findByRole("button", { name: "Sign Out" });
    expect(banner()).toBeNull();
  });

  it("shows in the editor, which opens read-only and sends no save", async () => {
    server.use(
      configHandler(readOnlyConfig),
      meHandler(),
      surveyHandler(sampleSurvey),
      definitionHandler({ title: "First" }, '"v1"'),
      themeHandler({ themeName: "default" }, '"t1"'),
    );
    const writes: string[] = [];
    const record = ({ request }: { request: Request }) => {
      if (request.method !== "GET") writes.push(request.method);
    };
    server.events.on("request:start", record);
    try {
      renderApp(`/surveys/${sampleSurvey.id}/edit`);
      await screen.findByTestId("fake-creator");

      expect(banner()).not.toBeNull();
      expect(editor.props!.saves).toBeNull();
      expect(editor.props!.uploads).toBeNull();
      expect(screen.getByText("Read-only")).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await waitFor(() => expect(writes).toEqual([]));
    } finally {
      server.events.removeListener("request:start", record);
    }
  });
});
