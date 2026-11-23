import { describe, expect, it } from "vitest";
import { rateLimitClassOf } from "./rate-limit-classes.js";

describe("rateLimitClassOf", () => {
  it("puts the respondent's operations in the public class", () => {
    for (const id of ["getPublicDefinition", "submitResponse", "getPublicLayout"]) {
      expect(rateLimitClassOf(id), id).toBe("public");
    }
  });

  it("puts file downloads in the file class", () => {
    expect(rateLimitClassOf("downloadFile")).toBe("file");
    expect(rateLimitClassOf("getLegacyFile")).toBe("file");
  });

  it("gives the question summary its own class", () => {
    expect(rateLimitClassOf("getQuestionSummary")).toBe("summary");
  });

  it("limits no other operation by these classes", () => {
    expect(rateLimitClassOf("getCurrentUser")).toBeNull();
    expect(rateLimitClassOf("login")).toBeNull();
    expect(rateLimitClassOf("noSuchOperation")).toBeNull();
  });
});
