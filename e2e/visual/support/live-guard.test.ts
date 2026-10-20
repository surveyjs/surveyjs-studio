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

  it("counts a write to any other host too", () => {
    expect(isLiveWrite("POST", "https://www.google-analytics.com/collect")).toBe(true);
    expect(isLiveWrite("POST", "https://evil-surveyjs.io/x")).toBe(true);
    expect(isLiveWrite("PATCH", "https://surveyjs.io.example.com/x")).toBe(true);
    expect(isLiveWrite("GET", "https://cdn.example.com/x.js")).toBe(false);
  });

  it("counts a write to a URL it cannot parse, without throwing", () => {
    expect(isLiveWrite("POST", "not a url")).toBe(true);
    expect(isLiveWrite("GET", "not a url")).toBe(false);
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
  it("lets the two reading POSTs through", () => {
    expect(isLiveWrite("POST", "https://surveyjs.io/api/CodeViewer/getfiles")).toBe(false);
    expect(isLiveWrite("POST", "https://surveyjs.io/api/cart/calcprepare")).toBe(false);
  });

  it("has one entry per reading POST", () => {
    expect(LIVE_READ_ALLOWLIST).toHaveLength(2);
  });

  it("keeps any other path, host or method a write", () => {
    expect(isLiveWrite("POST", "https://surveyjs.io/api/cart/calcprepare/x")).toBe(true);
    expect(isLiveWrite("POST", "https://surveyjs.io/api/CodeViewer/other")).toBe(true);
    expect(isLiveWrite("POST", "https://api.surveyjs.io/api/CodeViewer/getfiles")).toBe(true);
    expect(isLiveWrite("PUT", "https://surveyjs.io/api/CodeViewer/getfiles")).toBe(true);
  });
});
