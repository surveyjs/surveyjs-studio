import { describe, expect, it } from "vitest";
import { isLiveWrite, isTracker, LIVE_READ_ALLOWLIST } from "./live-guard.js";

describe("isLiveWrite", () => {
  it("lets a GET to surveyjs.io through", () => {
    expect(isLiveWrite("GET", "https://surveyjs.io/Service/MySurveys/personal")).toBe(false);
    expect(isLiveWrite("HEAD", "https://surveyjs.io/")).toBe(false);
    expect(isLiveWrite("OPTIONS", "https://api.surveyjs.io/x")).toBe(false);
  });

  it("counts any other method to surveyjs.io or a subdomain as a write", () => {
    expect(isLiveWrite("POST", "https://api.surveyjs.io/private/Surveys/x")).toBe(true);
    expect(isLiveWrite("PUT", "https://surveyjs.io/x")).toBe(true);
    expect(isLiveWrite("delete", "https://auth.surveyjs.io/x")).toBe(true);
  });

  it("does not count a write to another host", () => {
    expect(isLiveWrite("POST", "https://www.google-analytics.com/collect")).toBe(false);
    expect(isLiveWrite("POST", "https://evil-surveyjs.io/x")).toBe(false);
    expect(isLiveWrite("POST", "https://surveyjs.io.example.com/x")).toBe(false);
  });

  it("does not throw on a URL it cannot parse", () => {
    expect(isLiveWrite("POST", "not a url")).toBe(false);
  });
});

describe("isTracker", () => {
  it("knows the tracker hosts and their subdomains", () => {
    expect(isTracker("https://www.google-analytics.com/g/collect")).toBe(true);
    expect(isTracker("https://www.googletagmanager.com/gtm.js")).toBe(true);
    expect(isTracker("https://connect.facebook.net/en_US/fbevents.js")).toBe(true);
    expect(isTracker("https://www.clarity.ms/tag/x")).toBe(true);
  });

  it("does not take look-alike hosts or the site itself", () => {
    expect(isTracker("https://surveyjs.io/")).toBe(false);
    expect(isTracker("https://notfacebook.com/")).toBe(false);
  });
});

describe("LIVE_READ_ALLOWLIST", () => {
  it("starts empty", () => {
    expect(LIVE_READ_ALLOWLIST).toEqual([]);
  });
});
