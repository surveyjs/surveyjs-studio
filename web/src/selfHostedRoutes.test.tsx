import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSurveyProps } from "./run/RunSurvey";
import { renderApp } from "./test/renderApp";
import {
  publicResultPagesHandler,
  publishedSurveyHandler,
  samplePublishedSurvey,
} from "./test/public-handlers";
import { appConfig, configHandler, meHandler, server, surveyListPageHandlers } from "./test/server";

vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));
// jsdom does not run the Form Library or the Dashboard here.
vi.mock("./run/RunSurvey", () => ({
  RunSurvey: ({ data }: RunSurveyProps) => <p data-testid="fake-survey">{data.survey.name}</p>,
}));
vi.mock("./results/SummaryView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { SummaryView: fakeResultsWidget("fake-summary") };
});
vi.mock("./results/TableView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { TableView: fakeResultsWidget("fake-table") };
});

const branding = {
  name: "Acme Surveys",
  logoUrl: "/brand/logo.svg",
  accentColor: "#0a7",
  termsUrl: "https://acme.example/terms",
  privacyUrl: null,
  poweredBy: true,
};
const selfHosted = {
  ...appConfig,
  shell: "self-hosted",
  authMethods: ["password" as const],
  branding,
  features: { embed: false, apiDocs: false, apiTokens: false },
};

beforeEach(() => {
  server.use(...surveyListPageHandlers());
});

/** The page shows "Powered by SurveyJS" and Terms in the shell's footer (a lazy chunk: awaited). */
async function expectBranding() {
  const footer = await screen.findByRole("contentinfo");
  expect(
    within(footer).getByRole("link", { name: "Powered by SurveyJS (opens in a new tab)" }),
  ).toBeTruthy();
  expect(within(footer).getByRole("link", { name: "Terms" })).toBeTruthy();
}

describe("the self-hosted shell", () => {
  it("frames the private pages with the instance's name, logo and footer", async () => {
    server.use(configHandler(selfHosted), meHandler());

    renderApp("/");

    expect(await screen.findByRole("heading", { level: 1, name: "My Surveys" })).toBeTruthy();
    const header = screen.getAllByRole("banner")[0]!;
    expect(within(header).getByText("Acme Surveys")).toBeTruthy();
    expect(header.querySelector("img")).toBeTruthy();
    expect(within(header).getByRole("link", { name: "My Surveys" })).toBeTruthy();
    await expectBranding();
  });

  it("frames the sign-in page the same way, without account controls", async () => {
    server.use(configHandler(selfHosted));

    renderApp("/sign-in");

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(within(screen.getAllByRole("banner")[0]!).getByText("Acme Surveys")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
    await expectBranding();
  });

  it("frames the set-password page", async () => {
    server.use(configHandler(selfHosted));

    renderApp("/set-password?token=link-token");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Set your password" }),
    ).toBeTruthy();
    await expectBranding();
  });

  it("puts the footer under a running survey", async () => {
    server.use(configHandler(selfHosted), publishedSurveyHandler());

    renderApp(`/s/${samplePublishedSurvey.id}`);

    expect(await screen.findByTestId("fake-survey")).toBeTruthy();
    await expectBranding();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("frames the public results page", async () => {
    server.use(
      configHandler(selfHosted),
      publicResultPagesHandler(
        {
          id: samplePublishedSurvey.id,
          name: "Shared survey",
          definition: samplePublishedSurvey.definition,
          privateQuestions: [],
        },
        [[]],
      ),
    );

    renderApp(`/results/${samplePublishedSurvey.id}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Shared survey" })).toBeTruthy();
    await expectBranding();
    // The page has its own main landmark; the frame adds none.
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("has no footer under a running survey in the surveyjs-site shell", async () => {
    server.use(configHandler(), publishedSurveyHandler());

    renderApp(`/s/${samplePublishedSurvey.id}`);

    expect(await screen.findByTestId("fake-survey")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Powered by SurveyJS (opens in a new tab)" }),
    ).toBeNull();
  });
});
