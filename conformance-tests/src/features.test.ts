/**
 * The shell's features and branding (D21, ADR 0027): `/config.features` follows the shell the
 * server reports, and `/api/docs` is served only where `features.apiDocs` is true. Runs against
 * any server; the password run uses the self-hosted shell (`CONFORMANCE_AUTH=password`).
 */
import { describe, expect, it } from "vitest";
import { baseUrl, call } from "./harness.js";

interface Config {
  readonly shell: string;
  readonly features?: {
    readonly embed: boolean;
    readonly apiDocs: boolean;
    readonly apiTokens: boolean;
  };
  readonly branding?: { readonly name: string; readonly poweredBy: boolean };
}

async function config(): Promise<Config> {
  const response = await call("GET", "/config");
  expect(response.status).toBe(200);
  return (await response.json()) as Config;
}

describe("the shell's features", () => {
  it("offers the Embed tab and API tokens only in the surveyjs-site shell", async () => {
    const { shell, features } = await config();
    expect(features).toBeDefined();
    const site = shell === "surveyjs-site";
    expect(features!.embed).toBe(site);
    expect(features!.apiTokens).toBe(site);
    if (!site) expect(features!.apiDocs).toBe(false);
  });

  it("reports the instance's branding", async () => {
    const { branding } = await config();
    expect(branding?.name.trim()).not.toBe("");
    expect(typeof branding?.poweredBy).toBe("boolean");
  });

  it("answers 404 at /api/docs where the API docs are off", async (ctx) => {
    const { features } = await config();
    if (features!.apiDocs) ctx.skip("the API docs are on in this shell");
    const response = await fetch(`${baseUrl}/api/docs`, { redirect: "manual" });
    expect(response.status).toBe(404);
  });
});
