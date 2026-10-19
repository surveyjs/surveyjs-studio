import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { PublicResults } from "../api/public";
import { publicResultsState } from "./publicResultsState";

const data: PublicResults = {
  survey: { id: "22222222-0000-4000-8000-a00000000001", name: "S", definition: {} },
  items: [],
};
const apiError = (status: number) =>
  new ApiError({ type: "about:blank", title: "t", status, code: "internal-error" });

describe("publicResultsState", () => {
  it("is loading while pending", () => {
    expect(publicResultsState({ status: "pending" })).toEqual({ kind: "loading" });
  });

  it.each([404, 400])("is unavailable for a %i", (status) => {
    expect(publicResultsState({ status: "error", error: apiError(status) })).toEqual({
      kind: "unavailable",
    });
  });

  it.each([
    ["429", apiError(429)],
    ["500", apiError(500)],
    ["a TypeError", new TypeError("Failed to fetch")],
  ])("is failed for %s", (_name, error) => {
    expect(publicResultsState({ status: "error", error })).toEqual({ kind: "failed" });
  });

  it("is ready with the data", () => {
    expect(publicResultsState({ status: "success", data })).toEqual({ kind: "ready", data });
  });
});
