import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "security-headers.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
