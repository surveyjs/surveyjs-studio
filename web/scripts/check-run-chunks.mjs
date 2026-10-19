// Checks the production build:
// - the public run page (`/s/$surveyId`) loads the Form Library and its styles (the `survey-form`
//   chunks) and no Creator, Ace or Dashboard code (spec: "The public run page never downloads
//   Creator or Dashboard code");
// - the results page (`/surveys/$surveyId/results`) reaches the Dashboard (`survey-dashboard`),
//   its table (`survey-dashboard-table`) and the export libraries (`survey-dashboard-export`) only
//   through dynamic imports: the route's own chunk (fetched by a hover preload) imports none of
//   them, and the table's chunk does not import the export libraries.
// Run by `pnpm build` after `vite build`; reads Vite's manifest (`build.manifest` in
// vite.config.ts) and exits with 1 on a failure.
import { readFile } from "node:fs/promises";

const ENTRY = "index.html";
const RUN_ROUTE = "src/routes/s/$surveyId.lazy.tsx";
const RESULTS_ROUTE = "src/routes/_private/surveys/$surveyId/results.lazy.tsx";
const FORBIDDEN =
  /(^|\/)(survey-creator|SurveyEditor|worker-json)-|[/.-]ace[.-]|survey-analytics|dashboard/i;
const FORM_JS = /^assets\/survey-form-.*\.js$/;
const FORM_CSS = /^assets\/survey-form-.*\.css$/;
const DASHBOARD_CODE = /dashboard|survey-analytics|tabulator/i;
const DASHBOARD_JS = /^assets\/survey-dashboard-(?!table-|export-)[^/]*\.js$/;
const DASHBOARD_TABLE_JS = /^assets\/survey-dashboard-table-[^/]*\.js$/;
const DASHBOARD_EXPORT_JS = /^assets\/survey-dashboard-export-[^/]*\.js$/;

const manifest = JSON.parse(
  await readFile(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"),
);

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

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-run-chunks: ${problem}`);
  process.exit(1);
}
console.log(
  "check-run-chunks: the run page loads the Form Library and no Creator or Dashboard code; " +
    "the results page loads the Dashboard, its table and the export libraries on demand.",
);
