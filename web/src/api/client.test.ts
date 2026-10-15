import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, client, shouldRetryQuery } from "./client";
import { appConfig, configHandler, server } from "../test/server";

describe("API client", () => {
  it("requests the base URL path with credentials included", async () => {
    let seen: { url: string; credentials: string } | undefined;
    server.use(
      mswHttp.get("*/api/v1/config", ({ request }) => {
        seen = { url: new URL(request.url).pathname, credentials: request.credentials };
        return HttpResponse.json(appConfig);
      }),
    );

    const { data } = await client.GET("/config");

    expect(seen).toEqual({ url: "/api/v1/config", credentials: "include" });
    expect(data).toEqual(appConfig);
  });

  it("returns the typed body from the contract", async () => {
    server.use(configHandler({ ...appConfig, edition: "hosted" }));

    const { data } = await client.GET("/config");

    expect(data?.edition).toBe("hosted");
  });
});

function apiError(status: number): ApiError {
  return new ApiError({ type: "about:blank", title: "Problem", status, code: "internal-error" });
}

describe("query retry policy", () => {
  it.each([400, 401, 403, 404, 409, 422])("fails fast on %i", (status) => {
    expect(shouldRetryQuery(0, apiError(status))).toBe(false);
  });

  it.each([408, 429, 500, 503])("retries %i up to 3 times", (status) => {
    expect(shouldRetryQuery(2, apiError(status))).toBe(true);
    expect(shouldRetryQuery(3, apiError(status))).toBe(false);
  });

  it("retries a network error up to 3 times", () => {
    expect(shouldRetryQuery(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});
