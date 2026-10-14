import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/global-setup.ts"],
    testTimeout: 15_000,
  },
});
