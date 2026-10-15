import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it } from "vitest";
import { client } from "./client";
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
