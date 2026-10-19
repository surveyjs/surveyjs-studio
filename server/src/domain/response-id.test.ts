import { describe, expect, it } from "vitest";
import { responseIdFor, uuidV5 } from "./response-id.js";

const SURVEY = "22222222-0000-4000-8000-a00000000001";

describe("uuidV5", () => {
  it("gives the RFC 9562 example for the DNS namespace", () => {
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });
});

describe("responseIdFor", () => {
  it("is stable for a survey and key, whatever the survey id's case", () => {
    expect(responseIdFor(SURVEY, "key-1")).toBe("d3a58460-1c39-5b76-b18d-b25e4e80a28c");
    expect(responseIdFor(SURVEY.toUpperCase(), "key-1")).toBe(
      "d3a58460-1c39-5b76-b18d-b25e4e80a28c",
    );
  });

  it("depends on the key's case and on the survey", () => {
    expect(responseIdFor(SURVEY, "Key-1")).toBe("65b20036-a996-543d-a1e2-e58a7c9c1319");
    expect(responseIdFor("22222222-0000-4000-8000-a00000000004", "key-1")).toBe(
      "733f2f62-fbea-56e1-ba02-97df2ca67cff",
    );
  });
});
