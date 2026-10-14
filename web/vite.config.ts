import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:3000";
const proxy = {
  "/api": backend,
  "/healthz": backend,
  "/readyz": backend,
};

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react" }), react()],
  server: { port: 5173, strictPort: true, proxy },
  // survey-core is intentionally one big lazy chunk (see src/surveyjs/license.ts).
  build: { chunkSizeWarningLimit: 1600 },
  preview: { port: 5173, strictPort: true, proxy },
});
