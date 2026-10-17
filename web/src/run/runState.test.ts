import { describe, expect, it } from "vitest";
import { ApiError, type Problem } from "../api/client";
import { samplePublishedSurvey } from "../test/public-handlers";
import type { RunSurveyData } from "./load";
import { runPageState } from "./runState";

const problem = (status: number, code: Problem["code"]) =>
  new ApiError({ type: "about:blank", title: code, status, code });

const data = (limitCookie: string | null, completed: boolean): RunSurveyData => ({
  survey: samplePublishedSurvey,
  limitCookie,
  completed,
});

describe("runPageState", () => {
  it("is loading while the query is pending", () => {
    expect(runPageState({ status: "pending" })).toEqual({ kind: "loading" });
  });

  it.each([
    ["a 404 survey-not-available", problem(404, "survey-not-available")],
    ["a 400 for a refused id", problem(400, "bad-request")],
  ])("is unavailable on %s", (_, error) => {
    expect(runPageState({ status: "error", error })).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["a 500", problem(500, "internal-error")],
    ["a 429", problem(429, "rate-limited")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("is failed on %s", (_, error) => {
    expect(runPageState({ status: "error", error })).toEqual({ kind: "failed" });
  });

  it("is completed when the limit is on and this browser has completed the survey", () => {
    const loaded = data("cookie", true);
    expect(runPageState({ status: "success", data: loaded })).toEqual({
      kind: "completed",
      data: loaded,
    });
  });

  it.each([
    ["completed without a limit", data(null, true)],
    ["a limit, not completed", data("cookie", false)],
    ["a plain survey", data(null, false)],
  ])("is running for %s", (_, loaded) => {
    expect(runPageState({ status: "success", data: loaded })).toEqual({
      kind: "running",
      data: loaded,
    });
  });
});
