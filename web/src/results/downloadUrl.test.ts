import { describe, expect, it } from "vitest";
import { exportResultsUrl, publicResultsUrl } from "./downloadUrl";

const id = "22222222-0000-4000-8000-a00000000001";

describe("exportResultsUrl", () => {
  it("builds the JSON and CSV export links", () => {
    expect(exportResultsUrl("/api/v1", id, "json")).toBe(
      `/api/v1/surveys/${id}/results/export?format=json`,
    );
    expect(exportResultsUrl("/api/v1", id, "csv")).toBe(
      `/api/v1/surveys/${id}/results/export?format=csv`,
    );
  });

  it("keeps an absolute base", () => {
    expect(exportResultsUrl("https://api.example.com/api/v1", id, "csv")).toBe(
      `https://api.example.com/api/v1/surveys/${id}/results/export?format=csv`,
    );
  });

  it("encodes the id", () => {
    expect(exportResultsUrl("/api/v1", "a/b c", "json")).toBe(
      "/api/v1/surveys/a%2Fb%20c/results/export?format=json",
    );
  });
});

describe("publicResultsUrl", () => {
  it("joins the origin and the results path", () => {
    expect(publicResultsUrl("http://localhost:5173", id)).toBe(
      `http://localhost:5173/results/${id}`,
    );
  });
});
