import { describe, expect, it } from "vitest";
import { deleteConfirmed, responseTime, settingToggle } from "./details";

describe("settingToggle", () => {
  it("offers Grant Access while public results are off", () => {
    expect(settingToggle("publicResults", false)).toEqual({
      text: "Toggle if you want to enable access to the survey results with a direct link.",
      button: "Grant Access",
      patch: { settings: { publicResults: true } },
    });
  });

  it("offers Disable Access while public results are on", () => {
    expect(settingToggle("publicResults", true)).toEqual({
      text: "Your Survey results can be accessible via direct Url.",
      button: "Disable Access",
      patch: { settings: { publicResults: false } },
    });
  });

  it("offers to save the respondent IP while it is off", () => {
    expect(settingToggle("storeRespondentIp", false)).toEqual({
      text: "Toggle to store the IP addresses of your respondents along with other answers",
      button: "Save Respondent IP in Results",
      patch: { settings: { storeRespondentIp: true } },
    });
  });

  it("offers to stop saving the respondent IP while it is on", () => {
    expect(settingToggle("storeRespondentIp", true)).toEqual({
      text: "The IP addresses of your respondents are stored along with other answers. Toggle not to store.",
      button: "Do not save Respondent IP in Results",
      patch: { settings: { storeRespondentIp: false } },
    });
  });
});

describe("deleteConfirmed", () => {
  it("accepts only the exact survey name", () => {
    expect(deleteConfirmed("Survey", "Survey")).toBe(true);
    expect(deleteConfirmed("survey", "Survey")).toBe(false);
    expect(deleteConfirmed("Survey ", "Survey")).toBe(false);
    expect(deleteConfirmed("", "Survey")).toBe(false);
    expect(deleteConfirmed("", "")).toBe(true);
  });
});

describe("responseTime", () => {
  it("formats in the viewer locale", () => {
    const iso = "2026-01-02T03:04:05.000Z";
    expect(responseTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});
