import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"] } },
      { test: { name: "contract", include: ["contract/src/**/*.test.ts"] } },
      {
        test: {
          name: "server",
          include: ["server/src/**/*.test.ts"],
          // Needs the Docker replica; run by the providers-azurite project.
          exclude: ["**/node_modules/**", "server/src/**/*.azurite.test.ts"],
        },
      },
      "web",
      { test: { name: "e2e-visual", include: ["e2e/visual/**/*.test.ts"] } },
      {
        // Needs the local replica (`pnpm demo:azurite:up`). Not part of `pnpm test:unit`;
        // run with `pnpm test:providers:azurite`, which reads docker/azurite.env.
        test: {
          name: "providers-azurite",
          include: ["server/src/**/*.azurite.test.ts"],
          globalSetup: ["server/src/legacy/replica.global-setup.ts"],
          // The files share one replica and the loader test reloads it: run them one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
