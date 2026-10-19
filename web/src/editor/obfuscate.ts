// The "Download obfuscated JSON" export of surveyjs.io's editor: a copy of the survey that keeps its
// structure and logic but none of its texts, so it can be shared (for example with support).
// Our own implementation of the behaviour described in research-legacy.md B.6.
import {
  Model,
  type Base,
  type LocalizableString,
  type PanelModelBase,
  type Question,
} from "survey-core";

/** A number in [0, 1), as `Math.random` gives. Tests pass their own. */
export type RandomSource = () => number;

/** The texts that are scrambled on the survey, its pages, panels and questions. */
const ELEMENT_TEXTS = [
  "title",
  "description",
  "requiredErrorText",
  "placeholder",
  "otherText",
  "otherPlaceholder",
  "minRateDescription",
  "maxRateDescription",
];
/** The item lists of a question whose texts are scrambled, and those texts. */
const ITEM_LISTS = ["choices", "columns", "rows", "validators"];
const ITEM_TEXTS = ["text", "title"];

const SMALL = "abcdefghijklmnopqrstuvwxyz";
const CAPITAL = SMALL.toUpperCase();

/** Every ASCII letter becomes a random letter of the same case; everything else stays. */
function scramble(text: string, random: RandomSource): string {
  return text.replace(/[a-z]/gi, (letter) => {
    const letters = letter === letter.toLowerCase() ? SMALL : CAPITAL;
    return letters[Math.min(letters.length - 1, Math.floor(random() * letters.length))]!;
  });
}

/**
 * The localizable text `name` of `owner`: its `loc…` property (a matrix column keeps its title on
 * its cell question and exposes it there), else the one registered under that name.
 */
function localizable(owner: Base, name: string): LocalizableString | undefined {
  const property = (owner as unknown as Record<string, unknown>)[
    `loc${name[0]!.toUpperCase()}${name.slice(1)}`
  ];
  if (property !== null && typeof property === "object" && "getJson" in property) {
    return property as LocalizableString;
  }
  return owner.getLocalizableString(name) ?? undefined;
}

/** Scrambles the stored value of one localizable text, in every locale it has. */
function scrambleText(owner: Base, name: string, random: RandomSource): void {
  const text = localizable(owner, name);
  if (!text) return;
  const stored: unknown = text.getJson();
  if (typeof stored === "string") {
    text.setJson(scramble(stored, random));
  } else if (stored !== null && typeof stored === "object") {
    const locales: Record<string, unknown> = {};
    for (const [locale, value] of Object.entries(stored)) {
      locales[locale] = typeof value === "string" ? scramble(value, random) : value;
    }
    text.setJson(locales);
  }
}

function scrambleElementTexts(owner: Base, random: RandomSource): void {
  for (const name of ELEMENT_TEXTS) scrambleText(owner, name, random);
}

function scrambleItemTexts(question: Question, random: RandomSource): void {
  const owner = question as unknown as Record<string, unknown>;
  for (const list of ITEM_LISTS) {
    const items = owner[list];
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown[]) {
      if (item === null || typeof item !== "object" || !("getLocalizableString" in item)) continue;
      for (const name of ITEM_TEXTS) scrambleText(item as Base, name, random);
    }
  }
}

/** Old name (lower case) → new name, by how expressions refer to the element. */
interface Renames {
  /** `{name}`: questions outside dynamic panels and matrices. */
  readonly plain: Map<string, string>;
  /** `{panel.name}`: the questions of a dynamic panel. */
  readonly panel: Map<string, string>;
  /** `{row.name}`: the columns of a matrix. */
  readonly row: Map<string, string>;
}

function contextOf(question: Question): keyof Renames {
  if (question.getType() === "matrixdropdowncolumn") return "row";
  return question.parentQuestion?.getType() === "paneldynamic" ? "panel" : "plain";
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `text` as it appears inside a JSON string. */
const inJson = (text: string) => JSON.stringify(text).slice(1, -1);

/**
 * Replaces the old names in the expressions of the survey's JSON text: `{old`, `{panel.old` and
 * `{row.old`, followed by `}`, `.` or `[`, without regard to case. All names are replaced in one
 * pass, so a new name that is also an old one is not replaced again.
 */
function renameInExpressions(text: string, renames: Renames): string {
  const all = new Set([...renames.plain.keys(), ...renames.panel.keys(), ...renames.row.keys()]);
  if (all.size === 0) return text;
  // Longest first, so a name that starts another one does not match its start.
  const names = [...all]
    .sort((a, b) => b.length - a.length)
    .map((name) => escapeRegExp(inJson(name)));
  const pattern = new RegExp(`\\{(panel\\.|row\\.)?(${names.join("|")})(?=[}.[])`, "gi");
  return text.replace(pattern, (match, prefix: string | undefined, name: string) => {
    const old = (JSON.parse(`"${name}"`) as string).toLowerCase();
    const own = prefix === "panel." ? renames.panel : prefix === "row." ? renames.row : undefined;
    const renamed =
      own?.get(old) ?? renames.plain.get(old) ?? renames.panel.get(old) ?? renames.row.get(old);
    return renamed === undefined ? match : `{${prefix ?? ""}${inJson(renamed)}`;
  });
}

/**
 * The obfuscated JSON text (indented with two spaces) of the survey `json`:
 *
 * 1. panels are renamed `panel1…`; questions (and matrix columns) `q1…`, and expressions follow;
 * 2. HTML questions are removed;
 * 3. the texts of the survey, its pages, panels and questions (title, description, error texts,
 *    placeholders, "Other" texts, rating descriptions) and of their choices, columns, rows and
 *    validators keep their length, case, digits, spaces and other characters, but every ASCII letter
 *    is replaced by a random one, in every locale.
 */
export function obfuscateSurvey(json: object, random: RandomSource = Math.random): string {
  // In design mode, as the Creator's own survey: conditions are not run, so the JSON gets no
  // `visible: false` from a `visibleIf` that is false without answers.
  const survey = new Model();
  survey.setDesignMode(true);
  survey.fromJSON(json);
  const panels = survey.getAllPanels(false, true) as PanelModelBase[];
  panels.forEach((panel, index) => {
    panel.name = `panel${index + 1}`;
  });

  scrambleElementTexts(survey, random);
  for (const page of survey.pages) scrambleElementTexts(page, random);
  for (const panel of panels) scrambleElementTexts(panel, random);

  for (const question of survey.getAllQuestions(false, true, false)) {
    if (question.getType() === "html") {
      (question.parent as PanelModelBase | null)?.removeElement(question);
      continue;
    }
    scrambleElementTexts(question, random);
    scrambleItemTexts(question, random);
  }

  const renames: Renames = { plain: new Map(), panel: new Map(), row: new Map() };
  survey.getAllQuestions(false, true, false).forEach((question, index) => {
    const name = `q${index + 1}`;
    const names = renames[contextOf(question)];
    const old = question.name.toLowerCase();
    if (!names.has(old)) names.set(old, name);
    question.name = name;
  });

  return renameInExpressions(JSON.stringify(survey.toJSON(), null, 2), renames);
}
