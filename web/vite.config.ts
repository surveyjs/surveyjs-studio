import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { sandboxBase } from "../scripts/sandbox-host/base-path.ts";
import { sandboxVersionPlugin } from "../scripts/sandbox-host/version-file.ts";
import { securityHeaders } from "../server/src/web/security-headers.ts";

// E2E_API_PROXY_TARGET points a second preview at another server (the e2e licence-notice run).
const backend = process.env["E2E_API_PROXY_TARGET"] ?? "http://127.0.0.1:3000";
const apiProxy = {
  "/api": backend,
  // The dev identity provider's "Sign in as…" page (IDENTITY_PROVIDER=dev only).
  "/__dev": backend,
  "/healthz": backend,
  "/readyz": backend,
};

/**
 * R17: the SPA's security headers on `vite preview`; the proxied paths keep the server's own. The
 * dev server gets none: Vite dev injects inline scripts. Under a sub-path (`base`, the sandbox's
 * `SANDBOX_BASE`) the headers are those of the app's path below it, so `/studio/s/x` is the run page.
 */
function securityHeadersPlugin(proxy: Record<string, string>): Plugin {
  const proxied = Object.keys(proxy);
  return {
    name: "my-surveys-security-headers",
    configurePreviewServer(server) {
      const https = Boolean(server.config.preview.https);
      const base = server.config.base;
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://preview.invalid").pathname;
        const appPath = pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
        if (!proxied.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
          for (const [name, value] of Object.entries(securityHeaders(appPath, { https }))) {
            res.setHeader(name, value);
          }
        }
        next();
      });
    },
  };
}

// The Survey Creator's packages and Monaco, plus the survey-core part only the editor uses: the
// themes (the run page applies a survey's stored theme without them).
const creatorModules =
  /[\\/]node_modules[\\/](survey-creator-core|survey-creator-react|monaco-editor)[\\/]|[\\/]node_modules[\\/]survey-core[\\/]fesm[\\/]themes[\\/]/;
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

// The Dashboard's charts (src/results/SummaryView.tsx): survey-analytics without its table entry,
// Chart.js and its colour helper.
const dashboardModules =
  /[\\/]node_modules[\\/](survey-analytics[\\/](?!(fesm[\\/])?survey\.analytics\.tabulator)|chart\.js[\\/]|@kurkle[\\/]color[\\/])/;
// The Dashboard's table (src/results/TableView.tsx): the table entry and its CSS, Tabulator and its CSS.
const dashboardTableModules =
  /[\\/]node_modules[\\/](tabulator-tables[\\/]|survey-analytics[\\/](fesm[\\/])?survey\.analytics\.tabulator)/;
// The table's PDF and Excel export (src/results/exportLibraries.ts), loaded on the first such
// export: jsPDF with what it imports statically (fflate; fast-png with iobuffer and pako; Babel's
// runtime helpers), its AutoTable plugin, and SheetJS. jsPDF's own dynamic imports (html2canvas,
// DOMPurify, canvg) stay in chunks of their own.
const dashboardExportModules =
  /[\\/]node_modules[\\/](jspdf|jspdf-autotable|xlsx|fflate|fast-png|iobuffer|pako|@babel[\\/]runtime)[\\/]/;

export default defineConfig(({ mode }) => {
  // The sandbox build (D1): the app with an in-browser mock back-end, so nothing is proxied.
  const sandbox = mode === "sandbox";
  const proxy = sandbox ? {} : apiProxy;
  // Where the sandbox lives on its host: `/` (the default) or a sub-path such as `/studio/`
  // (`SANDBOX_BASE`). The normal build is always at the root: the server serves it there.
  const base = sandbox ? sandboxBase(process.env) : "/";
  return {
    base,
    // The router plugin must come before the React plugin.
    plugins: [
      tanstackRouter({ target: "react" }),
      react(),
      securityHeadersPlugin(proxy),
      ...(sandbox ? [sandboxVersionPlugin({ base })] : []),
    ],
    server: { port: 5173, strictPort: true, proxy },
    // Only the sandbox has a public directory (the worker script and its settings).
    publicDir: sandbox ? "sandbox-public" : false,
    build: {
      ...(sandbox ? { outDir: "dist-sandbox" } : {}),
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
              // page only, src/editor/SurveyEditor.tsx), `survey-form-*` (the run page and the
              // editor) and `survey-dashboard-*` (the results page only: the Summary, the Table
              // tab's `survey-dashboard-table-*` and the first PDF or Excel export's
              // `survey-dashboard-export-*`); the build's chunk check (scripts/check-run-chunks.mjs)
              // keeps the Creator and the Dashboard out of the run page and the Dashboard out of the
              // results route's own chunk. Each group takes only the modules it names: their shared
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
              {
                name: "survey-dashboard",
                test: dashboardModules,
                priority: 3,
                includeDependenciesRecursively: false,
              },
              {
                name: "survey-dashboard-table",
                test: dashboardTableModules,
                priority: 3,
                includeDependenciesRecursively: false,
              },
              {
                name: "survey-dashboard-export",
                test: dashboardExportModules,
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
  };
});
