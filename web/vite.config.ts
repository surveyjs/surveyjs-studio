import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// E2E_API_PROXY_TARGET points a second preview at another server (the e2e licence-notice run).
const backend = process.env["E2E_API_PROXY_TARGET"] ?? "http://127.0.0.1:3000";
const proxy = {
  "/api": backend,
  // The dev identity provider's "Sign in as…" page (IDENTITY_PROVIDER=dev only).
  "/__dev": backend,
  "/healthz": backend,
  "/readyz": backend,
};

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react" }), react()],
  server: { port: 5173, strictPort: true, proxy },
  // survey-core is intentionally one big lazy chunk (see src/surveyjs/license.ts).
  build: { chunkSizeWarningLimit: 1600 },
  // The surveyjs-site shell compiles the site's own SCSS partials, which use @import.
  css: { preprocessorOptions: { scss: { silenceDeprecations: ["import"] } } },
  preview: { port: 5173, strictPort: true, proxy },
});
