// Checks the production build: the public run page (`/s/$surveyId`) loads the Form Library and its
// styles (the `survey-form` chunks) and no Creator, Ace or Dashboard code (spec: "The public run
// page never downloads Creator or Dashboard code"). Run by `pnpm build` after `vite build`; reads
// Vite's manifest (`build.manifest` in vite.config.ts) and exits with 1 on a failure.
import { readFile } from "node:fs/promises";

const ENTRY = "index.html";
const RUN_ROUTE = "src/routes/s/$surveyId.lazy.tsx";
const FORBIDDEN =
  /(^|\/)(survey-creator|SurveyEditor|worker-json)-|[/.-]ace[.-]|survey-analytics|dashboard/i;
const FORM_JS = /^assets\/survey-form-.*\.js$/;
const FORM_CSS = /^assets\/survey-form-.*\.css$/;

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

const files = [...collect(RUN_ROUTE, true, collect(ENTRY, false))].sort();
console.log(`The run page (${RUN_ROUTE}) can load:`);
for (const file of files) console.log(`  ${file}`);

const problems = [];
const forbidden = files.filter((file) => FORBIDDEN.test(file));
if (forbidden.length > 0) {
  problems.push(`Creator, Ace or Dashboard code on the run page: ${forbidden.join(", ")}`);
}
if (!files.some((file) => FORM_JS.test(file))) problems.push("No survey-form-*.js chunk.");
if (!files.some((file) => FORM_CSS.test(file))) problems.push("No survey-form-*.css file.");

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-run-chunks: ${problem}`);
  process.exit(1);
}
console.log("check-run-chunks: the run page loads the Form Library and no Creator code.");
