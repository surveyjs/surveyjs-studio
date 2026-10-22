import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DEFINITION,
  FEEDBACK_RESPONSES,
  HISTORY_SAVES,
  PROJECT_NAME,
} from "../data-set.js";
import { checklistText } from "./checklist.js";

describe("checklistText", () => {
  const text = checklistText();

  it("names every survey, the project and Grant Access", () => {
    for (const name of [
      "Customer feedback",
      "Event registration",
      "Product poll",
      "Old poll",
      "Team retro",
      PROJECT_NAME,
      "Grant Access",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("holds the definition JSON and the three responses", () => {
    expect(text).toContain(JSON.stringify(FEEDBACK_DEFINITION, null, 2));
    for (const response of FEEDBACK_RESPONSES) {
      expect(text).toContain(JSON.stringify(response, null, 2));
    }
  });

  it("asks for the editor saves the history screen needs", () => {
    expect(text).toContain(`${HISTORY_SAVES} saves for the history screen`);
    expect(text).toContain(`View History must list at least ${HISTORY_SAVES} entries`);
  });

  it("is numbered from 1 to 10", () => {
    expect(text).toMatch(/^1\. /m);
    expect(text).toMatch(/^10\. /m);
  });
});
