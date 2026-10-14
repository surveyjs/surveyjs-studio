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
    ],
  },
});
