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

// The Survey Creator's packages and Ace, plus the survey-core parts only the editor uses: all
// survey locales, the themes and the survey styles.
const creatorModules =
  /[\\/]node_modules[\\/](survey-creator-core|survey-creator-react|survey-react-ui|ace-builds)[\\/]|[\\/]node_modules[\\/]survey-core[\\/](fesm[\\/](i18n|themes)[\\/]|survey-core\.css)/;
// survey-core's own code (not its locales and themes): the licence key (src/surveyjs/license.ts)
// needs it without the Creator. Taken first, or the Creator group takes it as a dependency.
const surveyCoreModules =
  /[\\/]node_modules[\\/]survey-core[\\/](?!fesm[\\/](i18n|themes)[\\/]).*\.m?js$/;

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react" }), react()],
  server: { port: 5173, strictPort: true, proxy },
  build: {
    // survey-core (see src/surveyjs/license.ts) and the Survey Creator are intentionally big lazy
    // chunks.
    chunkSizeWarningLimit: 2900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // The Creator in one chunk with a stable name, loaded only by the editor page
            // (src/editor/SurveyEditor.tsx); the e2e tests look for this name.
            // Only these modules: their shared dependencies (React) stay where they are.
            {
              name: "survey-creator",
              test: creatorModules,
              priority: 1,
              includeDependenciesRecursively: false,
            },
            { name: "survey-core", test: surveyCoreModules, priority: 2 },
          ],
        },
      },
    },
  },
  // The surveyjs-site shell compiles the site's own SCSS partials, which use @import.
  css: { preprocessorOptions: { scss: { silenceDeprecations: ["import"] } } },
  preview: { port: 5173, strictPort: true, proxy },
});
