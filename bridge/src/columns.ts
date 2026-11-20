// The old API's result columns (reference behaviour: ADR 0040 point 4), as `getResultColumns`,
// `getResultPublicColumns` and the CSV export computed them: `HappendAt` ("Submitted"), the IP
// when the survey stores IPs, then a column per answer name the responses hold (and `ClientId`),
// ordered by the place of its question in the definition (names it does not hold first), titled
// with the question's title in a language; then merged with the survey's shared `columns` layout
// (its columns first, in its order). The survey's private questions take the place of the old
// permissions list. What the old calculation failed on throws `ColumnsRefused` (an empty `400`).
// The platform's text of each value (`True`, en-US dates) is the old server's.
import type { components } from "@surveyjs-studio/contract/types";
import { EMPTY_GUID } from "./binding.js";
import { dotnetDouble, JsonNumber, oldJson, parseOldDate } from "./dotnet-format.js";
import { cellText } from "./export-csv.js";
import { parseLenientJson } from "./json-body.js";

type SurveyResponse = components["schemas"]["SurveyResponse"];

/** `Visibility`: shown; hidden; hidden from public reads only. */
const VISIBLE = 0;
const PUBLIC_INVISIBLE = 2;
/** `Location`: a column of the table, or a row under it (files and images). */
const ROW = 1;
/** `DataType`: text, a file link, an image. */
const TEXT = 0;
const FILE_LINK = 1;
const IMAGE = 2;

const LIST_TEXT = "System.Collections.Generic.List`1[System.Object]";
const DICTIONARY_TEXT = "System.Collections.Generic.Dictionary`2[System.String,System.Object]";

/** A column as the old answer wrote it (properties in its order). */
export interface ResultColumn {
  Name: string;
  DisplayName: string | null;
  DataType: number;
  Visibility: number;
  Location: number;
  Id: string;
}

/** The old calculation failed on the definition or the layout: an empty `400`. */
export class ColumnsRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColumnsRefused";
  }
}

/** A response's answers (any parsed JSON) and its client ID. */
export interface ColumnRow {
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
}

export interface ColumnsInput {
  /** The survey's definition, parsed (`parseStudioJson` or `JSON.parse`). */
  readonly definition: unknown;
  /** Every response, newest first ({@link newestFirst}). */
  readonly rows: Iterable<ColumnRow>;
  /** The shared `columns` layout's text; `null` without one. */
  readonly columnsLayout: string | null;
  /** The survey's private questions (the old permissions' `isPublic: false`). */
  readonly privateQuestions: readonly string[];
  /** The language of the titles; `null` takes each title's first text. */
  readonly locale: string | null;
  /** Whether the survey stores respondents' IPs. */
  readonly storeIp: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof JsonNumber);

/** A date the old reader made of a layout text: its en-US text. */
class OldDate {
  constructor(readonly text: string) {}
}

/** A number's platform text: integers as they are, others as doubles. */
function numberText(value: number): string {
  return Number.isSafeInteger(value) ? String(value) : dotnetDouble(value);
}

/** A layout value as the old reader held it: a date-like text as a date. */
function oldValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return parseOldDate(value) === null ? value : new OldDate(cellText(value));
}

/** A value's platform text (`ToString()`); `null` for none. */
function clrText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof OldDate) return value.text;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return numberText(value);
  return Array.isArray(value) ? LIST_TEXT : DICTIONARY_TEXT;
}

/**
 * A stored `visibility` or `location` as the old read took it: a text as an integer (any other
 * text as the default), a whole number as it is; anything else failed.
 */
function enumValue(value: unknown, what: string): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const match = /^[\t-\r ]*([+-]?[0-9]+)[\t-\r ]*$/.exec(value);
    const number = match === null ? Number.NaN : Number(match[1]);
    return Number.isNaN(number) || Math.abs(number) > 2_147_483_647 ? 0 : number;
  }
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 2_147_483_647) {
    return value;
  }
  throw new ColumnsRefused(`a stored ${what} that is no number`);
}

/** A column's values by name, as the old column held them, and its data type (not stored). */
class Column {
  constructor(
    readonly values: Map<string, unknown>,
    readonly dataType = TEXT,
  ) {}

  static named(name: string, dataType = TEXT): Column {
    return new Column(new Map([["name", name]]), dataType);
  }

  get name(): string | null {
    return clrText(this.values.get("name"));
  }

  get displayName(): string | null {
    return this.values.has("displayname") ? clrText(this.values.get("displayname")) : this.name;
  }

  get visibility(): number {
    return enumValue(this.values.get("visibility"), "visibility");
  }

  get location(): number {
    return enumValue(this.values.get("location"), "location");
  }

  answer(): ResultColumn {
    return {
      Name: this.name ?? "",
      DisplayName: this.displayName,
      DataType: this.dataType,
      Visibility: this.visibility,
      Location: this.location,
      Id: EMPTY_GUID,
    };
  }
}

/** A token of a definition walked in document order, as the old JSON library listed them. */
type Token =
  | { kind: "property"; name: string; value: unknown }
  | { kind: "object"; value: Record<string, unknown> }
  | { kind: "array"; value: unknown[] }
  | { kind: "value"; value: unknown };

function tokenOf(value: unknown): Token {
  if (Array.isArray(value)) return { kind: "array", value };
  if (isObject(value)) return { kind: "object", value };
  return { kind: "value", value };
}

/** Every token inside `container`, in document order (a walk without recursion). */
function* descendants(container: Record<string, unknown> | unknown[]): Generator<Token> {
  const pending: Token[] = [];
  const pushChildren = (inner: Record<string, unknown> | unknown[]) => {
    const children: Token[] = Array.isArray(inner)
      ? inner.map(tokenOf)
      : Object.entries(inner).map(([name, value]) => ({ kind: "property", name, value }));
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  };
  pushChildren(container);
  while (pending.length > 0) {
    const token = pending.pop()!;
    yield token;
    if (token.kind === "property") pending.push(tokenOf(token.value));
    else if (token.kind === "object" || token.kind === "array") pushChildren(token.value);
  }
}

/** A definition value's text as the old JSON library gave it: scalars as the platform, else indented JSON. */
function tokenText(value: unknown): string {
  if (Array.isArray(value) || isObject(value)) return oldJson(value, true);
  return cellText(value);
}

/** The definition as the old calculation read it. */
class Definition {
  /** Every object holding a `name`, in document order, with its name's text. */
  private readonly named: { object: Record<string, unknown>; name: string }[] = [];
  readonly commentSuffix: string;

  constructor(
    definition: unknown,
    private readonly locale: string | null,
  ) {
    if (!isObject(definition)) throw new ColumnsRefused("a definition that is no JSON object");
    for (const token of descendants(definition)) {
      if (token.kind === "object" && Object.hasOwn(token.value, "name")) {
        this.named.push({ object: token.value, name: tokenText(token.value.name) });
      }
    }
    const prefix = Object.hasOwn(definition, "commentPrefix")
      ? tokenText(definition.commentPrefix)
      : "";
    this.commentSuffix = prefix === "" ? "-Comment" : prefix;
  }

  /** Where an answer name's question stands: its name, else its name and the comment suffix; -1 for none. */
  placeOf(name: string): number {
    const index = this.named.findIndex((entry) => entry.name === name);
    if (index >= 0) return index;
    return this.named.findIndex((entry) => entry.name + this.commentSuffix === name);
  }

  question(name: string): Record<string, unknown> | undefined {
    return this.named.find((entry) => entry.name === name)?.object;
  }

  /**
   * A question's title in the language: a text as it is; else the first property of that name
   * within it, else its first value; none fails.
   */
  title(question: Record<string, unknown>): string {
    const title = question.title;
    if (Array.isArray(title)) throw new ColumnsRefused("a title that is a list");
    if (!isObject(title)) return tokenText(title);
    let first: Token | undefined;
    for (const token of descendants(title)) {
      if (token.kind === "property" && token.name === this.locale) return tokenText(token.value);
      if (first === undefined && token.kind === "value") first = token;
    }
    if (first === undefined) throw new ColumnsRefused("a title without a text");
    return tokenText(first.value);
  }
}

/** The columns the responses give, before any layout. */
function computedColumns(input: ColumnsInput, definition: Definition): Column[] {
  // Each answer name with its data type, in the order the responses (newest first) give them.
  const dataTypes = new Map<string, number>();
  const note = (name: string, value: unknown) => {
    let dataType = dataTypes.get(name) ?? TEXT;
    if (typeof value === "string" && value !== "") {
      if (value.startsWith("dxsimage:")) dataType = IMAGE;
      else if (value.startsWith("dxsfile:")) dataType = FILE_LINK;
    }
    dataTypes.set(name, dataType);
  };
  for (const row of input.rows) {
    if (row.clientId !== undefined) note("clientid", row.clientId);
    for (const [name, value] of Object.entries(row.data)) note(name, value);
  }

  const columns: Column[] = [];
  const happendAt = Column.named("HappendAt");
  happendAt.values.set("displayname", "Submitted");
  columns.push(happendAt);
  if (input.storeIp) {
    const ip = Column.named("IPAddress");
    ip.values.set("visibility", PUBLIC_INVISIBLE);
    columns.push(ip);
  }
  // A stable sort; the old one was stable for the column counts surveys have.
  const ordered = [...dataTypes]
    .map(([name, dataType]) => ({ name, dataType, place: definition.placeOf(name) }))
    .sort((a, b) => a.place - b.place);
  const suffix = definition.commentSuffix;
  for (const { name, dataType } of ordered) {
    if (name === "id") continue;
    const column = Column.named(name, dataType);
    if (dataType !== TEXT) column.values.set("location", ROW);
    if (name === "clientid") {
      column.values.set("name", "ClientId");
      column.values.set("visibility", PUBLIC_INVISIBLE);
      column.values.set("displayname", "Client Id");
    }
    const isComment = name.endsWith(suffix);
    const question = definition.question(isComment ? name.slice(0, name.indexOf(suffix)) : name);
    if (question !== undefined && Object.hasOwn(question, "title")) {
      const title = definition.title(question);
      column.values.set("displayname", isComment ? `${suffix}\n${title}` : title);
    }
    columns.push(column);
  }
  return columns;
}

/** A layout entry's values, as the old reader held them. */
function valuesOf(entry: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(entry).map(([name, value]) => [name, oldValue(value)]));
}

/** The layout's `columns` as the old reader took them: a list of objects (or nulls), or none. */
function storedColumns(value: unknown): Column[] {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === null) return new Column(new Map());
      if (!isObject(entry)) throw new ColumnsRefused("a stored column that is no object");
      return new Column(valuesOf(entry));
    });
  }
  // A text or an object was walked as a list (and failed unless empty); anything else is none.
  if (typeof value === "string" && value !== "" && parseOldDate(value) === null) {
    throw new ColumnsRefused("stored columns that are a text");
  }
  if (isObject(value) && Object.keys(value).length > 0) {
    throw new ColumnsRefused("stored columns that are an object");
  }
  return [];
}

/** The computed columns merged with a layout's: its columns first, in its order, then the rest. */
function merged(columns: Column[], layoutText: string, privateQuestions: readonly string[]) {
  const layout = parseLenientJson(layoutText)?.value;
  if (!isObject(layout)) throw new ColumnsRefused("a layout that is no JSON object");
  const stored = storedColumns(layout.columns);
  const values = valuesOf(layout);
  const newColumnsVisibility = enumValue(values.get("newcolumnsvisibility"), "visibility");
  // The private questions are the old permissions list's `isPublic: false`.
  for (const name of privateQuestions) {
    stored.find((column) => column.name === name)?.values.set("visibility", PUBLIC_INVISIBLE);
  }
  if (stored.length === 0) return columns;

  const current = new Map(columns.map((column) => [column.name!, column]));
  const result: Column[] = [];
  for (const column of stored) {
    const name = column.name;
    const computed = name === null ? undefined : current.get(name);
    if (computed === undefined) continue;
    if (computed.values.has("displayname") && !column.values.has("displayname")) {
      column.values.set("displayname", computed.displayName);
    }
    current.delete(name!);
    result.push(column);
  }
  for (const column of current.values()) {
    // A copy of its values only: its data type is not among them.
    const copy = new Column(new Map(column.values));
    if (copy.visibility === VISIBLE) copy.values.set("visibility", newColumnsVisibility);
    result.push(copy);
  }
  return result;
}

/** The columns of the old result calculation. Throws `ColumnsRefused` where it failed. */
export function calculateColumns(input: ColumnsInput): ResultColumn[] {
  const definition = new Definition(input.definition, input.locale);
  let columns = computedColumns(input, definition);
  if (input.columnsLayout !== null && input.columnsLayout !== "") {
    columns = merged(columns, input.columnsLayout, input.privateQuestions);
  }
  return columns.map((column) => column.answer());
}

/** Responses newest first, by the time they were submitted (equal times keep their order). */
export function newestFirst<T extends { readonly submittedAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
}

/** The old `{ Columns, Id }` answer from every response. Throws `ColumnsRefused` where it failed. */
export async function resultColumns(input: {
  definition: object;
  responses: AsyncIterable<SurveyResponse>;
  columnsLayout: string | null;
  privateQuestions: string[];
  locale: string;
  storeIp: boolean;
}): Promise<{ Columns: ResultColumn[]; Id: string }> {
  const rows: SurveyResponse[] = [];
  for await (const response of input.responses) rows.push(response);
  return { Columns: calculateColumns({ ...input, rows: newestFirst(rows) }), Id: EMPTY_GUID };
}
