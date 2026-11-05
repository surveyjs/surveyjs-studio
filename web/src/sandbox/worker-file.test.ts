// Both files are read as text with Vite's `?raw`: the web's type check has no Node types, and the
// web setup file needs jsdom.
import copy from "../../sandbox-public/mockServiceWorker.js?raw";
import installed from "../../node_modules/msw/lib/mockServiceWorker.js?raw";
import { describe, expect, it } from "vitest";

describe("the sandbox's service worker file", () => {
  it("is msw's own file", () => {
    expect(
      copy === installed,
      "web/sandbox-public/mockServiceWorker.js differs from msw's: copy msw/lib/mockServiceWorker.js again after upgrading msw",
    ).toBe(true);
  });
});
