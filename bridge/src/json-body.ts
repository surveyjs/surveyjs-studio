// The old API's JSON body binding (ADR 0039 point 1: error texts are part of the answer). The old
// API read `post`'s body with a lenient JSON reader (comments, single quotes, bare property names,
// trailing commas) and listed each binding error in its validation answer under the error's JSON
// path, with the reader's line and position. This module reproduces that reader and its recovery:
// an error in one property is recorded and reading goes on with the next one; an error outside a
// property ends the binding.
import { parseGuid } from "./binding.js";

export type PropertyKind = "guid" | "string" | "boolean";

type Value<K extends PropertyKind> = K extends "guid"
  ? string
  : K extends "string"
    ? string | null
    : boolean | null;

export type BoundModel<P extends Record<string, PropertyKind>> = { [N in keyof P]?: Value<P[N]> };

export interface BindResult<P extends Record<string, PropertyKind>> {
  /** `null` for an empty body or `null`; otherwise the properties found. */
  model: BoundModel<P> | null;
  /** Messages by JSON path (`""` for the body itself); empty when the body bound. */
  errors: Record<string, string[]>;
}

/** The text where the old API gave a message naming its own types. */
export const GENERIC_INPUT_ERROR = "The input was not valid.";

const MAX_DEPTH = 32;

type Token =
  | "None"
  | "StartObject"
  | "EndObject"
  | "StartArray"
  | "EndArray"
  | "PropertyName"
  | "String"
  | "Integer"
  | "Float"
  | "Boolean"
  | "Null"
  | "Undefined";

type State =
  | "Start"
  | "ObjectStart"
  | "Object"
  | "ArrayStart"
  | "Array"
  | "Property"
  | "PostValue"
  | "Finished";

interface Container {
  type: "object" | "array";
  name: string | null;
  index: number;
}

/**
 * A reader or binding error, its message already carrying path, line and position. Not an `Error`:
 * a body can hold an error per property, and capturing a stack for each would cost more than the
 * reading.
 */
class BindingError {
  constructor(
    readonly message: string,
    readonly path: string,
  ) {}
}

/** An error whose text the old API built from its own type names: the generic text instead. */
class GenericError {
  readonly message = GENERIC_INPUT_ERROR;
  constructor(readonly path: string) {}
}

// .NET's char.IsWhiteSpace.
const WHITESPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const IDENTIFIER = /[\p{L}\p{Nd}_$]/u;
// Characters that put a property name in brackets in a path.
const PATH_SPECIAL = /[. '/"[\]()\t\n\r\f\b\\\u0085\u2028\u2029]/;
const NUMBER_CHAR = /[-.0-9a-fA-FxX+]/;
const SEPARATOR =
  /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000,}\])/]/;
// Unambiguous, so a long refused number is checked in linear time.
const VALID_NUMBER = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

/** A character the old boolean parse trimmed: whitespace or NUL. */
function isTrimmed(c: string): boolean {
  return c.charCodeAt(0) === 0 || WHITESPACE.test(c);
}

/** The text without leading and trailing whitespace and NUL characters (a scan, linear time). */
function trimWhitespaceAndNul(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isTrimmed(text[start]!)) start += 1;
  while (end > start && isTrimmed(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

function escapePathName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are escaped in a path
  return name.replace(/[\\'\u0000-\u001f\u0085\u2028\u2029]/g, (c) => {
    const named: Record<string, string> = {
      "\\": "\\\\",
      "'": "\\'",
      "\n": "\\n",
      "\r": "\\r",
      "\t": "\\t",
      "\b": "\\b",
      "\f": "\\f",
    };
    return named[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

class Reader {
  private pos = 0;
  private line = 1;
  private lineStart = 0;
  private state: State = "Start";
  private readonly stack: Container[] = [];
  private current: Token = "None";
  value: string | boolean | null = null;

  constructor(
    private readonly text: string,
    private readonly maxDepth: number = MAX_DEPTH,
  ) {}

  /** The current token (a method, so a check of it does not outlive the next read). */
  token(): Token {
    return this.current;
  }

  /** The JSON path of the current token, as the old reader wrote it. */
  path(): string {
    const inside = this.state !== "ObjectStart" && this.state !== "ArrayStart";
    const containers = inside ? this.stack : this.stack.slice(0, -1);
    let path = "";
    for (const container of containers) {
      if (container.type === "array") {
        path += `[${container.index}]`;
        continue;
      }
      const name = container.name ?? "";
      if (PATH_SPECIAL.test(name)) path += `['${escapePathName(name)}']`;
      else path += path === "" ? name : `.${name}`;
    }
    return path;
  }

  /** The reader's depth: open containers, a start token not counting its own. */
  depth(): number {
    const start = this.current === "StartObject" || this.current === "StartArray";
    return start ? this.stack.length - 1 : this.stack.length;
  }

  error(message: string): BindingError {
    let text = message.trim();
    if (!text.endsWith(".")) text += ".";
    const path = this.path();
    return new BindingError(
      `${text} Path '${path}', line ${this.line}, position ${this.pos - this.lineStart}.`,
      path,
    );
  }

  generic(): GenericError {
    return new GenericError(this.path());
  }

  private get char(): string | undefined {
    return this.text[this.pos];
  }

  private unexpectedValueChar(c: string): BindingError {
    return this.error(`Unexpected character encountered while parsing value: ${c}.`);
  }

  /** Consumes a line break (`\r\n` as one) or one whitespace character; false for anything else. */
  private eatSpace(): boolean {
    const c = this.char;
    if (c === "\n" || c === "\r") {
      this.pos += c === "\r" && this.text[this.pos + 1] === "\n" ? 2 : 1;
      this.line += 1;
      this.lineStart = this.pos;
      return true;
    }
    if (c !== undefined && WHITESPACE.test(c)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** Consumes a comment at `/`. */
  private comment(): void {
    this.pos += 1;
    const c = this.char;
    if (c === "*") {
      this.pos += 1;
      for (;;) {
        if (this.char === undefined) throw this.error("Unexpected end while parsing comment.");
        if (this.char === "*" && this.text[this.pos + 1] === "/") {
          this.pos += 2;
          return;
        }
        if (!this.eatSpace()) this.pos += 1;
      }
    }
    if (c === "/") {
      while (this.char !== undefined && this.char !== "\r" && this.char !== "\n") this.pos += 1;
      return;
    }
    throw this.error(`Error parsing comment. Expected: *, got ${c ?? ""}.`);
  }

  private push(type: Container["type"]): void {
    const parent = this.stack.at(-1);
    if (parent?.type === "array") parent.index += 1;
    this.stack.push({ type, name: null, index: -1 });
    this.current = type === "object" ? "StartObject" : "StartArray";
    this.state = type === "object" ? "ObjectStart" : "ArrayStart";
    this.value = null;
    if (this.stack.length > this.maxDepth) {
      throw this.error(`The reader's MaxDepth of ${this.maxDepth} has been exceeded.`);
    }
  }

  private end(type: Container["type"]): void {
    const top = this.stack.at(-1);
    const name = type === "object" ? "Object" : "Array";
    if (top?.type !== type) {
      const open = top === undefined ? "None" : top.type === "object" ? "Object" : "Array";
      throw this.error(`JsonToken End${name} is not valid for closing JsonType ${open}.`);
    }
    this.stack.pop();
    this.current = type === "object" ? "EndObject" : "EndArray";
    this.value = null;
    this.state = this.stack.length > 0 ? "PostValue" : "Finished";
  }

  private setValue(token: Token, value: string | boolean | null): void {
    const parent = this.stack.at(-1);
    if (parent?.type === "array") parent.index += 1;
    this.current = token;
    this.value = value;
    this.state = this.stack.length > 0 ? "PostValue" : "Finished";
  }

  private string(): string {
    const quote = this.char!;
    this.pos += 1;
    let value = "";
    for (;;) {
      const c = this.char;
      if (c === undefined) throw this.error(`Unterminated string. Expected delimiter: ${quote}.`);
      if (c === quote) {
        this.pos += 1;
        return value;
      }
      if (c === "\r" || c === "\n") {
        value += c === "\r" && this.text[this.pos + 1] === "\n" ? "\r\n" : c;
        this.eatSpace();
        continue;
      }
      if (c !== "\\") {
        // A run of ordinary characters at once.
        const start = this.pos;
        while (this.pos < this.text.length) {
          const next = this.text[this.pos];
          if (next === quote || next === "\\" || next === "\r" || next === "\n") break;
          this.pos += 1;
        }
        value += this.text.slice(start, this.pos);
        continue;
      }
      this.pos += 1;
      const escape = this.char;
      if (escape === undefined)
        throw this.error(`Unterminated string. Expected delimiter: ${quote}.`);
      const simple: Record<string, string> = {
        b: "\b",
        t: "\t",
        n: "\n",
        f: "\f",
        r: "\r",
        "\\": "\\",
        '"': '"',
        "'": "'",
        "/": "/",
      };
      if (escape in simple) {
        value += simple[escape];
        this.pos += 1;
      } else if (escape === "u") {
        const hex = this.text.slice(this.pos + 1, this.pos + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.pos = Math.min(this.pos + 5, this.text.length);
          throw this.error(`Invalid Unicode escape sequence: \\u${hex}.`);
        }
        value += String.fromCharCode(parseInt(hex, 16));
        this.pos += 5;
      } else {
        this.pos += 1;
        throw this.error(`Bad JSON escape sequence: \\${escape}.`);
      }
    }
  }

  /** The text of a number at the current position, checked as the old reader checked it. */
  private number(): string {
    const start = this.pos;
    for (;;) {
      const c = this.char;
      if (c === undefined || SEPARATOR.test(c)) break;
      if (!NUMBER_CHAR.test(c)) {
        throw this.error(`Unexpected character encountered while parsing number: ${c}.`);
      }
      this.pos += 1;
    }
    const text = this.text.slice(start, this.pos);
    if (!VALID_NUMBER.test(text)) {
      const kind = /[.eE]/.test(text) ? "number" : "integer";
      throw this.error(`Input string '${text}' is not a valid ${kind}.`);
    }
    return text;
  }

  /** Matches a literal followed by a separator; on a mismatch the position is where it differs. */
  private literal(word: string): boolean {
    for (let i = 0; i < word.length; i += 1) {
      const c = this.text[this.pos + i];
      if (c === undefined) {
        this.pos = this.text.length;
        throw this.error("Unexpected end when reading JSON.");
      }
      if (c !== word[i]) {
        this.pos += i;
        return false;
      }
    }
    const next = this.text[this.pos + word.length];
    if (next !== undefined && !SEPARATOR.test(next)) {
      this.pos += word.length;
      return false;
    }
    this.pos += word.length;
    return true;
  }

  private literalToken(
    word: string,
    token: Token,
    value: string | boolean | null,
    failure: string,
  ): void {
    if (!this.literal(word)) throw this.error(failure);
    this.setValue(token, value);
  }

  /** Reads a value where one is expected; false at the end of the text. */
  private parseValue(): boolean {
    for (;;) {
      const c = this.char;
      if (c === undefined) {
        this.current = "None";
        return false;
      }
      switch (c) {
        case '"':
        case "'":
          this.setValue("String", this.string());
          return true;
        case "t":
          this.literalToken("true", "Boolean", true, "Error parsing boolean value.");
          return true;
        case "f":
          this.literalToken("false", "Boolean", false, "Error parsing boolean value.");
          return true;
        case "n":
          this.literalToken("null", "Null", null, "Error parsing null value.");
          return true;
        case "u":
          this.literalToken("undefined", "Undefined", null, "Error parsing undefined value.");
          return true;
        case "N":
          this.literalToken("NaN", "Float", "NaN", "Cannot read NaN value.");
          return true;
        case "I":
          this.literalToken("Infinity", "Float", "Infinity", "Cannot read Infinity value.");
          return true;
        case "/":
          this.comment();
          continue;
        case "{":
          this.pos += 1;
          this.push("object");
          return true;
        case "[":
          this.pos += 1;
          this.push("array");
          return true;
        case "]":
          this.pos += 1;
          this.end("array");
          return true;
        case ",":
          // An empty value: the comma is read next.
          this.setValue("Undefined", null);
          return true;
        default:
          if (c === "-" && this.text[this.pos + 1] === "I") {
            this.literalToken("-Infinity", "Float", "-Infinity", "Cannot read -Infinity value.");
            return true;
          }
          if (c === "-" || c === "." || (c >= "0" && c <= "9")) {
            const text = this.number();
            this.setValue(/[.eE]/.test(text) ? "Float" : "Integer", text);
            return true;
          }
          if (this.eatSpace()) continue;
          this.pos += 1;
          throw this.unexpectedValueChar(c);
      }
    }
  }

  private parseProperty(): void {
    const c = this.char!;
    let name: string;
    if (c === '"' || c === "'") {
      name = this.string();
    } else if (IDENTIFIER.test(c)) {
      const start = this.pos;
      while (this.char !== undefined && IDENTIFIER.test(this.char)) this.pos += 1;
      const next = this.char;
      if (next === undefined)
        throw this.error("Unexpected end while parsing unquoted property name.");
      if (next !== ":" && !WHITESPACE.test(next)) {
        throw this.error(`Invalid JavaScript property identifier character: ${next}.`);
      }
      name = this.text.slice(start, this.pos);
    } else {
      throw this.error(`Invalid property identifier character: ${c}.`);
    }
    while (this.eatSpace());
    if (this.char !== ":") {
      throw this.error(
        `Invalid character after parsing property name. Expected ':' but got: ${this.char ?? "\u0000"}.`,
      );
    }
    this.pos += 1;
    this.stack.at(-1)!.name = name;
    this.current = "PropertyName";
    this.value = name;
    this.state = "Property";
  }

  private parseObject(): boolean {
    for (;;) {
      const c = this.char;
      if (c === undefined) return false;
      if (this.eatSpace()) continue;
      if (c === "/") {
        this.comment();
        continue;
      }
      if (c === "}") {
        this.pos += 1;
        this.end("object");
        return true;
      }
      this.parseProperty();
      return true;
    }
  }

  /** After a value: an end token (`"token"`), a comma (`"comma"`), or the end of the text. */
  private parsePostValue(): "token" | "comma" | "end" {
    for (;;) {
      const c = this.char;
      if (c === undefined) {
        this.state = "Finished";
        return "end";
      }
      if (c === "}" || c === "]") {
        this.pos += 1;
        this.end(c === "}" ? "object" : "array");
        return "token";
      }
      if (c === ",") {
        this.pos += 1;
        this.state = this.stack.at(-1)?.type === "array" ? "Array" : "Object";
        return "comma";
      }
      if (c === "/") {
        this.comment();
        continue;
      }
      if (this.eatSpace()) continue;
      throw this.error(`After parsing a value an unexpected character was encountered: ${c}.`);
    }
  }

  /** The next token, comments skipped; false at the end. */
  read(): boolean {
    for (;;) {
      switch (this.state) {
        case "Start":
        case "Property":
        case "Array":
        case "ArrayStart":
          return this.parseValue();
        case "ObjectStart":
        case "Object":
          if (this.parseObject()) return true;
          this.current = "None";
          return false;
        case "PostValue": {
          const next = this.parsePostValue();
          if (next === "token") return true;
          if (next === "end") {
            this.current = "None";
            return false;
          }
          break;
        }
        case "Finished":
          this.current = "None";
          return false;
      }
    }
  }

  /**
   * Reads a value as a string or a boolean, as the old reader's typed reads did: `asString` takes
   * numbers and `true`/`false` as their text; `asBoolean` takes `true`/`false`, numbers (not zero
   * is true) and the strings `true`/`false` in any case. Either takes `null` (and `""` for a
   * boolean) as null. Sets `token` (`None` at the end).
   */
  readAs(kind: "string" | "boolean"): void {
    if (this.state === "PostValue") {
      const next = this.parsePostValue();
      if (next === "token") return;
      if (next === "end") {
        this.current = "None";
        return;
      }
    }
    for (;;) {
      const c = this.char;
      if (c === undefined) {
        this.current = "None";
        return;
      }
      switch (c) {
        case '"':
        case "'": {
          const text = this.string();
          if (kind === "string") return this.setValue("String", text);
          if (text === "") return this.setValue("Null", null);
          const trimmed = trimWhitespaceAndNul(text).toLowerCase();
          if (trimmed === "true" || trimmed === "false") {
            return this.setValue("Boolean", trimmed === "true");
          }
          // The old reader took the string as read before refusing it.
          this.setValue("String", text);
          throw this.error(`Could not convert string to boolean: ${text}.`);
        }
        case "t":
        case "f": {
          const word = c === "t" ? "true" : "false";
          if (!this.literal(word)) throw this.unexpectedValueChar(this.char ?? "");
          return kind === "string"
            ? this.setValue("String", word)
            : this.setValue("Boolean", word === "true");
        }
        case "n":
          if (!this.literal("null")) throw this.error("Error parsing null value.");
          return this.setValue("Null", null);
        case "/":
          this.comment();
          continue;
        case ",": {
          this.pos += 1;
          const error = this.unexpectedValueChar(",");
          this.pos -= 1;
          throw error;
        }
        case "]":
          this.pos += 1;
          if (this.state === "Array" || this.state === "ArrayStart") return this.end("array");
          throw this.unexpectedValueChar("]");
        default:
          if (
            kind === "string" &&
            (c === "N" || c === "I" || (c === "-" && this.text[this.pos + 1] === "I"))
          ) {
            const word = c === "N" ? "NaN" : c === "I" ? "Infinity" : "-Infinity";
            if (!this.literal(word)) throw this.unexpectedValueChar(this.char ?? "");
            return this.setValue("String", word);
          }
          if (c === "-" || c === "." || (c >= "0" && c <= "9")) {
            const text = this.number();
            return kind === "string"
              ? this.setValue("String", text)
              : this.setValue("Boolean", Number(text) !== 0);
          }
          if (this.eatSpace()) continue;
          this.pos += 1;
          throw this.unexpectedValueChar(c);
      }
    }
  }

  /** Whether only whitespace and comments are left. */
  atEnd(): boolean {
    for (;;) {
      if (this.char === undefined) return true;
      if (this.char === "/") this.comment();
      else if (!this.eatSpace()) return false;
    }
  }

  /** Skips the current property's value, or the current container, as the old reader did. */
  skip(): void {
    if (this.current === "PropertyName") this.read();
    if (this.current === "StartObject" || this.current === "StartArray") {
      const depth = this.depth();
      while (this.read() && depth < this.depth());
    }
  }
}

/** An integer's digits without a plus sign or leading zeros (`-0` is `0`); other text as it is. */
function normalizedInteger(text: string): string {
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  if (!/^[0-9]+$/.test(digits)) return text;
  let first = 0;
  while (first < digits.length - 1 && digits[first] === "0") first += 1;
  const value = digits.slice(first);
  return negative && value !== "0" ? `-${value}` : value;
}

/** How the old reader showed a value in "Error converting value …". */
function shown(reader: Reader): string {
  switch (reader.token()) {
    case "String":
      return `"${String(reader.value)}"`;
    case "Integer":
      return normalizedInteger(String(reader.value));
    case "Float":
      return String(Number(reader.value));
    case "Boolean":
      return reader.value === true ? "True" : "False";
    default:
      return "{null}";
  }
}

/** Reads a GUID property: the old binder's conversion of the token it read. */
function readGuid(reader: Reader, name: string): string {
  if (!reader.read()) throw reader.error(`Unexpected end when setting ${name}'s value.`);
  if (reader.token() === "StartObject" || reader.token() === "StartArray") throw reader.generic();
  const guid = reader.token() === "String" ? parseGuid(String(reader.value)) : null;
  if (guid === null) {
    throw reader.error(`Error converting value ${shown(reader)} to type 'System.Guid'.`);
  }
  return guid;
}

/** The key the old API listed an error under: its path, with the member added when missing. */
function errorKey(path: string, member: string | null): string {
  if (member === null || member === "") return path;
  let add = true;
  if (path.length === member.length) add = path !== member;
  else if (path.length > member.length) {
    add = member.startsWith("[")
      ? !path.endsWith(member)
      : !path.endsWith(`.${member}`) &&
        !path.endsWith(`['${member}']`) &&
        !path.endsWith(`[${member}]`);
  }
  if (!add) return path;
  if (path === "") return member;
  return member.startsWith("[") ? `${path}${member}` : `${path}.${member}`;
}

/**
 * Binds a JSON body to an object with the given properties (matched exactly, else in any letter
 * case), as the old API bound `post`'s body: unknown properties are skipped, a repeated one's last
 * value wins, content after the object is ignored.
 */
export function bindJsonBody<P extends Record<string, PropertyKind>>(
  text: string,
  properties: P,
): BindResult<P> {
  const reader = new Reader(text);
  // No prototype: a path such as `__proto__` or `constructor` is an ordinary key.
  const errors = Object.create(null) as Record<string, string[]>;
  const record = (error: unknown, member: string | null): void => {
    if (!(error instanceof BindingError) && !(error instanceof GenericError)) throw error;
    const key = errorKey(error.path, member);
    (errors[key] ??= []).push(error.message);
  };
  const names = Object.keys(properties);
  const match = (name: string): string | undefined =>
    names.find((known) => known === name) ??
    names.find((known) => known.toLowerCase() === name.toLowerCase());

  let model: Record<string, unknown> | null = null;
  try {
    if (!reader.read() || reader.token() === "Null" || reader.token() === "Undefined") {
      return { model: null, errors };
    }
    if (reader.token() !== "StartObject") throw reader.generic();
    model = {};
    if (!reader.read()) throw reader.error("Unexpected end when reading JSON.");
    let finished = false;
    do {
      if (reader.token() === "EndObject") {
        finished = true;
        break;
      }
      // Only property names and the object's end can follow in an object.
      const member = String(reader.value);
      try {
        const known = match(member);
        if (known === undefined) {
          if (reader.read()) reader.skip();
        } else if (properties[known] === "guid") {
          model[known] = readGuid(reader, member);
        } else {
          reader.readAs(properties[known] === "string" ? "string" : "boolean");
          if (reader.token() === "None") {
            throw reader.error(`Unexpected end when setting ${member}'s value.`);
          }
          model[known] = reader.value;
        }
      } catch (error) {
        record(error, member);
        reader.skip();
      }
    } while (reader.read());
    if (!finished) throw reader.error("Unexpected end when deserializing object.");
  } catch (error) {
    record(error, null);
  }
  return { model: model as BoundModel<P> | null, errors };
}

/** The depth the old readers of stored answers allowed. */
const ANSWERS_MAX_DEPTH = 64;

/** The value at the reader's current token, containers read to their end. */
function valueAt(reader: Reader): unknown {
  switch (reader.token()) {
    case "StartObject": {
      // No prototype: an answer named `__proto__` is an ordinary property.
      const object = Object.create(null) as Record<string, unknown>;
      for (;;) {
        if (!reader.read()) throw reader.error("Unexpected end when reading JSON.");
        if (reader.token() === "EndObject") return object;
        const name = String(reader.value);
        if (!reader.read()) throw reader.error("Unexpected end when reading JSON.");
        object[name] = valueAt(reader);
      }
    }
    case "StartArray": {
      const array: unknown[] = [];
      for (;;) {
        if (!reader.read()) throw reader.error("Unexpected end when reading JSON.");
        if (reader.token() === "EndArray") return array;
        array.push(valueAt(reader));
      }
    }
    case "Integer":
    case "Float": {
      const number = Number(reader.value);
      return Number.isFinite(number) ? number : null;
    }
    case "String":
    case "Boolean":
      return reader.value;
    default:
      return null;
  }
}

/**
 * Parses stored answers as the old API's readers did: the lenient syntax of its reader, depth up to
 * 64, nothing but comments after the value. `undefined` when the text is not such JSON.
 */
export function parseLenientJson(text: string): { value: unknown } | undefined {
  const reader = new Reader(text, ANSWERS_MAX_DEPTH);
  try {
    if (!reader.read()) return undefined;
    const value = valueAt(reader);
    return reader.atEnd() ? { value } : undefined;
  } catch (error) {
    if (error instanceof BindingError) return undefined;
    throw error;
  }
}
