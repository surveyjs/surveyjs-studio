import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { client } from "./client";
import { appConfig, server } from "../test/server";

afterEach(() => {
  document.cookie = "msid_csrf=; Max-Age=0";
});

function captureHeaders() {
  const seen: Record<string, string | null> = {};
  server.use(
    mswHttp.get("*/api/v1/config", ({ request }) => {
      seen["GET"] = request.headers.get("X-CSRF-Token");
      return HttpResponse.json(appConfig);
    }),
    mswHttp.post("*/api/v1/auth/logout", ({ request }) => {
      seen["POST"] = request.headers.get("X-CSRF-Token");
      return HttpResponse.json({ redirectUrl: "https://example.test/" });
    }),
  );
  return seen;
}

describe("CSRF middleware", () => {
  it("sends the msid_csrf cookie value on POST", async () => {
    document.cookie = "other=1";
    document.cookie = "msid_csrf=abc_DEF-123";
    const seen = captureHeaders();

    await client.POST("/auth/logout");

    expect(seen["POST"]).toBe("abc_DEF-123");
  });

  it("sends a malformed cookie value as it is instead of failing", async () => {
    document.cookie = "msid_csrf=abc%E0%A4%A";
    const seen = captureHeaders();

    await client.POST("/auth/logout");

    expect(seen["POST"]).toBe("abc%E0%A4%A");
  });

  it("sends no token on GET", async () => {
    document.cookie = "msid_csrf=abc";
    const seen = captureHeaders();

    await client.GET("/config");

    expect(seen["GET"]).toBeNull();
  });

  it("sends no token on POST when there is no cookie", async () => {
    const seen = captureHeaders();

    await client.POST("/auth/logout");

    expect(seen["POST"]).toBeNull();
  });
});
