import { defineConfig } from "vitest/config";

// CONFORMANCE_PROVIDER=sandbox (sandbox.env): each test file registers the sandbox's mock handlers
// with msw/node first, over a store of its own (src/sandbox-setup.ts).
const sandbox = process.env.CONFORMANCE_PROVIDER?.trim() === "sandbox";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/global-setup.ts"],
    ...(sandbox && { setupFiles: ["src/sandbox-setup.ts"] }),
    testTimeout: 15_000,
  },
});
