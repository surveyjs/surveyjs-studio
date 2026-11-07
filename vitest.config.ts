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
          // Need Docker: run by the providers-azurite and providers-postgres projects.
          exclude: [
            "**/node_modules/**",
            "server/src/**/*.azurite.test.ts",
            "server/src/**/*.postgres.test.ts",
            "server/src/**/*.s3.test.ts",
          ],
        },
      },
      {
        // Needs PostgreSQL (`pnpm postgres:up`). Not part of `pnpm test:unit`; run with
        // `pnpm test:providers:postgres`, which reads docker/postgres.env. Each test file makes
        // its own scratch databases, so the files run in parallel.
        test: {
          name: "providers-postgres",
          include: ["server/src/**/*.postgres.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Needs the local S3 server (`pnpm s3:up`). Not part of `pnpm test:unit`; run with
        // `pnpm test:providers:s3`, which reads docker/s3.env. Each file makes its own buckets.
        test: {
          name: "providers-s3",
          include: ["server/src/**/*.s3.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      "web",
      {
        test: {
          name: "e2e-visual",
          include: ["e2e/visual/**/*.test.ts", "e2e/scripts/**/*.test.ts"],
        },
      },
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
