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

// The Survey Creator's packages and Ace, plus the survey-core part only the editor uses: the
// themes (the run page applies a survey's stored theme without them).
const creatorModules =
  /[\\/]node_modules[\\/](survey-creator-core|survey-creator-react|ace-builds)[\\/]|[\\/]node_modules[\\/]survey-core[\\/]fesm[\\/]themes[\\/]/;
// The Form Library's React UI and the survey styles: the run page (src/run/RunSurvey.tsx) and the
// editor (src/editor/SurveyEditor.tsx) both use them.
const surveyFormModules =
  /[\\/]node_modules[\\/](survey-react-ui[\\/]|survey-core[\\/]survey-core\.css)/;
// All of the Form Library's locales: the editor, and the run page for a survey in another
// language (src/run/surveyLocales.ts, imported on demand).
const surveyLocaleModules = /[\\/]node_modules[\\/]survey-core[\\/]fesm[\\/]i18n[\\/]/;
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
    // dist/.vite/manifest.json: the chunk check reads each route's chunks from it.
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Chunks with stable names. The e2e tests look for `survey-creator-*` (the editor
            // page only, src/editor/SurveyEditor.tsx) and `survey-form-*` (the run page and the
            // editor); the build's chunk check (scripts/check-run-chunks.mjs) keeps the Creator
            // out of the run page. Each group takes only the modules it names: their shared
            // dependencies (React, survey-core) stay where they are.
            {
              name: "survey-creator",
              test: creatorModules,
              priority: 1,
              includeDependenciesRecursively: false,
            },
            { name: "survey-core", test: surveyCoreModules, priority: 2 },
            {
              name: "survey-form",
              test: surveyFormModules,
              priority: 3,
              includeDependenciesRecursively: false,
            },
            {
              name: "survey-i18n",
              test: surveyLocaleModules,
              priority: 3,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  // The surveyjs-site shell compiles the site's own SCSS partials, which use @import.
  css: { preprocessorOptions: { scss: { silenceDeprecations: ["import"] } } },
  preview: { port: 5173, strictPort: true, proxy },
});
