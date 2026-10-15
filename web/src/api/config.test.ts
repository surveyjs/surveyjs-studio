import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { configQueryOptions } from "./config";
import { appConfig, configHandler, problemHandler, server } from "../test/server";

const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("config loader", () => {
  it("returns the server's config", async () => {
    server.use(configHandler({ ...appConfig, shell: "other-shell", surveyjsLicenseKey: "KEY" }));

    const config = await newQueryClient().ensureQueryData(configQueryOptions);

    expect(config).toMatchObject({
      edition: "self-hosted",
      shell: "other-shell",
      surveyjsLicenseKey: "KEY",
    });
  });

  it("surfaces the Problem for an error response", async () => {
    server.use(problemHandler(503, "not-implemented", "Service unavailable"));

    await expect(newQueryClient().ensureQueryData(configQueryOptions)).rejects.toMatchObject({
      message: "Service unavailable",
      problem: { status: 503, code: "not-implemented" },
    });
  });

  it("caches the config for five minutes", () => {
    expect(configQueryOptions.staleTime).toBe(5 * 60 * 1000);
  });
});
