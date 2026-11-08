import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIENT_ROUTES, isClientRoute } from "./client-routes.js";

const ROUTES_DIR = fileURLToPath(new URL("../../../web/src/routes/", import.meta.url));

/**
 * The path of each route file of the web app's router, with `abc` for each `$param`: `_private/`
 * (a layout without a path) dropped, `index` the parent's own path. The root, the layout file and
 * the lazy halves (`*.lazy.tsx`, the same path as their eager file) add no path.
 */
function routeFilePaths(): string[] {
  return readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".lazy.tsx"))
    .filter((file) => file !== "__root.tsx" && file !== "_private.tsx")
    .map((file) => {
      const segments = file
        .slice(0, -".tsx".length)
        .split("/")
        .filter((segment) => segment !== "_private" && segment !== "index")
        .map((segment) => (segment.startsWith("$") ? "abc" : segment));
      return `/${segments.join("/")}`;
    });
}

describe("isClientRoute", () => {
  it.each([
    "/",
    "/projects",
    "/projects/",
    "/surveys/abc/edit",
    "/surveys/abc/history",
    "/surveys/abc/results",
    "/s/abc",
    "/results/abc",
    "/sign-in",
    "/set-password",
    "/change-password",
    "/admin/users",
  ])("%s is a client route", (pathname) => {
    expect(isClientRoute(pathname)).toBe(true);
  });

  it.each([
    "/published",
    "/Service/EditSurvey/abc",
    "/surveys/abc",
    "/surveys/a/b/edit",
    "/s/",
    "/no-such-page",
  ])("%s is not a client route", (pathname) => {
    expect(isClientRoute(pathname)).toBe(false);
  });
});

describe("CLIENT_ROUTES", () => {
  const paths = routeFilePaths();

  it("finds the router's files", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it("has a pattern for every route file of web/src/routes", () => {
    const unmatched = paths.filter((path) => !CLIENT_ROUTES.some((route) => route.test(path)));
    expect(unmatched).toEqual([]);
  });

  it("has a route file for every pattern", () => {
    const unused = CLIENT_ROUTES.filter((route) => !paths.some((path) => route.test(path)));
    expect(unused.map(String)).toEqual([]);
  });
});
