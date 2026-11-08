// Checks the production build:
// - the public run page (`/s/$surveyId`) loads the Form Library and its styles (the `survey-form`
//   chunks) and no Creator, Ace or Dashboard code (spec: "The public run page never downloads
//   Creator or Dashboard code");
// - the results page (`/surveys/$surveyId/results`) reaches the Dashboard (`survey-dashboard`),
//   its table (`survey-dashboard-table`) and the export libraries (`survey-dashboard-export`) only
//   through dynamic imports: the route's own chunk (fetched by a hover preload) imports none of
//   them, and the table's chunk does not import the export libraries;
// - the public results page (`/results/$surveyId`) is the same: no Dashboard code in the route's
//   own chunks, the Dashboard and its table only through dynamic imports.
// - the normal build (any directory but a sandbox one) holds no sandbox code: no manifest entry under
//   `src/sandbox/`, no chunk that mentions `mockServiceWorker`, no `mockServiceWorker.js` file.
// Run by `pnpm build` after `vite build`; reads Vite's manifest (`build.manifest` in
// vite.config.ts) and exits with 1 on a failure. The build directory is the first argument
// (default `dist`; `dist-sandbox` for the sandbox build).
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";

const ENTRY = "index.html";
const RUN_ROUTE = "src/routes/s/$surveyId.lazy.tsx";
const RESULTS_ROUTE = "src/routes/_private/surveys/$surveyId/results.lazy.tsx";
const PUBLIC_RESULTS_ROUTE = "src/routes/results/$surveyId.lazy.tsx";
const FORBIDDEN =
  /(^|\/)(survey-creator|SurveyEditor|worker-json)-|[/.-]ace[.-]|survey-analytics|dashboard/i;
const FORM_JS = /^assets\/survey-form-.*\.js$/;
const FORM_CSS = /^assets\/survey-form-.*\.css$/;
const DASHBOARD_CODE = /dashboard|survey-analytics|tabulator/i;
const DASHBOARD_JS = /^assets\/survey-dashboard-(?!table-|export-)[^/]*\.js$/;
const DASHBOARD_TABLE_JS = /^assets\/survey-dashboard-table-[^/]*\.js$/;
const DASHBOARD_EXPORT_JS = /^assets\/survey-dashboard-export-[^/]*\.js$/;

const DIST = process.argv[2] ?? "dist";
const distUrl = new URL(`../${DIST}/`, import.meta.url);
const SANDBOX_BUILD = /sandbox/.test(DIST);

const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", distUrl), "utf8"));

/**
 * The files (JS and CSS) of `key` and of the chunks it imports, recursively. The entry's
 * dynamic imports are the app's other routes, so they are followed only from other chunks.
 */
function collect(key, followDynamic, files = new Set(), seen = new Set()) {
  if (seen.has(key)) return files;
  seen.add(key);
  const chunk = manifest[key];
  if (chunk === undefined) throw new Error(`The manifest has no entry ${key}.`);
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  const next = [...(chunk.imports ?? [])];
  if (followDynamic && !chunk.isEntry) next.push(...(chunk.dynamicImports ?? []));
  for (const imported of next) collect(imported, followDynamic, files, seen);
  return files;
}

/** The manifest key of the chunk whose file matches `pattern`. */
function chunkKey(pattern) {
  return Object.keys(manifest).find((key) => pattern.test(manifest[key].file));
}

function print(title, files) {
  console.log(title);
  for (const file of files) console.log(`  ${file}`);
}

const problems = [];

if (SANDBOX_BUILD) {
  for (const file of ["mockServiceWorker.js", "sandbox.config.json"]) {
    if (!existsSync(new URL(file, distUrl))) problems.push(`${DIST}/${file} is missing.`);
  }
} else {
  const sandboxEntries = Object.keys(manifest).filter(
    (key) => key.startsWith("src/sandbox/") || (manifest[key].src ?? "").startsWith("src/sandbox/"),
  );
  if (sandboxEntries.length > 0) {
    problems.push(`Sandbox sources in the normal build: ${sandboxEntries.join(", ")}`);
  }
  if (existsSync(new URL("mockServiceWorker.js", distUrl))) {
    problems.push(`${DIST}/mockServiceWorker.js exists in the normal build.`);
  }
  // The manifest lists only entries and dynamic imports, so a sandbox module merged into a shared
  // chunk is found by what it contains: the storage key (src/sandbox/store.ts) and a user id only
  // seed.json holds. "mockServiceWorker" is msw's default worker URL (start.ts uses it); it
  // catches msw, not other sandbox code.
  const MARKERS = [
    "mockServiceWorker",
    "studio-sandbox:v1",
    "11111111-0000-4000-8000-a00000000001",
  ];
  const mentioning = [];
  for (const name of await readdir(new URL("assets/", distUrl))) {
    if (!name.endsWith(".js")) continue;
    const text = await readFile(new URL(`assets/${name}`, distUrl), "utf8");
    const found = MARKERS.filter((marker) => text.includes(marker));
    if (found.length > 0) mentioning.push(`assets/${name} (${found.join(", ")})`);
  }
  if (mentioning.length > 0) {
    problems.push(`Chunks with sandbox code in the normal build: ${mentioning.join(", ")}`);
  }
}

const runFiles = [...collect(RUN_ROUTE, true, collect(ENTRY, false))].sort();
print(`The run page (${RUN_ROUTE}) can load:`, runFiles);
const forbidden = runFiles.filter((file) => FORBIDDEN.test(file));
if (forbidden.length > 0) {
  problems.push(`Creator, Ace or Dashboard code on the run page: ${forbidden.join(", ")}`);
}
if (!runFiles.some((file) => FORM_JS.test(file))) problems.push("No survey-form-*.js chunk.");
if (!runFiles.some((file) => FORM_CSS.test(file))) problems.push("No survey-form-*.css file.");

const resultsStatic = [...collect(RESULTS_ROUTE, false)].sort();
print(`The results route (${RESULTS_ROUTE}) imports statically:`, resultsStatic);
const eager = resultsStatic.filter((file) => DASHBOARD_CODE.test(file));
if (eager.length > 0) {
  problems.push(`Dashboard code in the results route's own chunks: ${eager.join(", ")}`);
}
const resultsAll = [...collect(RESULTS_ROUTE, true)].sort();
print(`The results page (${RESULTS_ROUTE}) can load:`, resultsAll);
for (const [pattern, name] of [
  [DASHBOARD_JS, "survey-dashboard-*.js"],
  [DASHBOARD_TABLE_JS, "survey-dashboard-table-*.js"],
  [DASHBOARD_EXPORT_JS, "survey-dashboard-export-*.js"],
]) {
  if (!resultsAll.some((file) => pattern.test(file))) {
    problems.push(`The results page has no ${name} chunk.`);
  }
}
const tableKey = chunkKey(DASHBOARD_TABLE_JS);
if (tableKey !== undefined) {
  const tableStatic = [...collect(tableKey, false)];
  const exportFiles = tableStatic.filter((file) => DASHBOARD_EXPORT_JS.test(file));
  if (exportFiles.length > 0) {
    problems.push(`The table chunk imports the export libraries: ${exportFiles.join(", ")}`);
  }
}

const publicStatic = [...collect(PUBLIC_RESULTS_ROUTE, false)].sort();
print(`The public results route (${PUBLIC_RESULTS_ROUTE}) imports statically:`, publicStatic);
const publicEager = publicStatic.filter((file) => DASHBOARD_CODE.test(file));
if (publicEager.length > 0) {
  problems.push(
    `Dashboard code in the public results route's own chunks: ${publicEager.join(", ")}`,
  );
}
const publicAll = [...collect(PUBLIC_RESULTS_ROUTE, true)].sort();
print(`The public results page (${PUBLIC_RESULTS_ROUTE}) can load:`, publicAll);
for (const [pattern, name] of [
  [DASHBOARD_JS, "survey-dashboard-*.js"],
  [DASHBOARD_TABLE_JS, "survey-dashboard-table-*.js"],
]) {
  if (!publicAll.some((file) => pattern.test(file))) {
    problems.push(`The public results page has no ${name} chunk.`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-run-chunks: ${problem}`);
  process.exit(1);
}
console.log(
  "check-run-chunks: the run page loads the Form Library and no Creator or Dashboard code; " +
    "the results page loads the Dashboard, its table and the export libraries on demand; " +
    "the public results page loads the Dashboard and its table on demand.",
);
