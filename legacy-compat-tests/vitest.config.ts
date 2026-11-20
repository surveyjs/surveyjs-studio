import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/global-setup.ts"],
    // The Azurite replica is one store for every file; the cases create and remove their own
    // surveys, so the files could run in parallel, but one at a time keeps Studio's load low.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
