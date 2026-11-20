// Parameters as the old API bound them: GUIDs in every form it parsed, query parameters with its
// validation texts, and the client IDs Studio can hold.
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendValidationProblem } from "./answers.js";
import { queryValues } from "./routes.js";

/** The GUID a missing parameter bound as; no survey has it. */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

const HEX = "[0-9a-fA-F]";
const D_FORM = new RegExp(`^(${HEX}{8})-(${HEX}{4})-(${HEX}{4})-(${HEX}{4})-(${HEX}{12})$`);
const N_FORM = new RegExp(`^(${HEX}{8})(${HEX}{4})(${HEX}{4})(${HEX}{4})(${HEX}{12})$`);
const X_PART = (digits: number) => `0[xX](${HEX}{1,${digits}})`;
const X_FORM = new RegExp(
  `^\\{${X_PART(8)},${X_PART(4)},${X_PART(4)},\\{${Array.from({ length: 8 }, () => X_PART(2)).join(",")}\\}\\}$`,
);

/**
 * A GUID in any form the old API parsed (`D`, `N`, `{D}`, `(D)`, and the `{0x…,…}` form, any
 * letter case, surrounded by whitespace), as lower-case `D`; `null` when the text is none of them.
 */
export function parseGuid(text: string): string | null {
  const trimmed = text.trim();
  let match = D_FORM.exec(trimmed) ?? N_FORM.exec(trimmed);
  if (match === null && trimmed.length === 38) {
    const [open, close] = [trimmed[0], trimmed[37]];
    if ((open === "{" && close === "}") || (open === "(" && close === ")")) {
      match = D_FORM.exec(trimmed.slice(1, -1));
    }
  }
  if (match !== null) return match.slice(1).join("-").toLowerCase();
  const x = X_FORM.exec(trimmed.replace(/\s+/g, ""));
  if (x === null) return null;
  const [a, b, c, ...bytes] = x
    .slice(1)
    .map((part, index) => part.padStart(index === 0 ? 8 : index < 3 ? 4 : 2, "0"));
  const tail = bytes.join("");
  return `${a}-${b}-${c}-${tail.slice(0, 4)}-${tail.slice(4)}`.toLowerCase();
}

export type GuidParameter = { guid: string } | { error: string };

/**
 * A GUID query parameter as the old API bound it: missing binds as {@link EMPTY_GUID}; a value
 * that is empty or only whitespace, or that is no GUID, is an error with the old text, which
 * quotes every value the parameter has, joined by commas.
 */
export function bindGuidQuery(request: FastifyRequest, name: string): GuidParameter {
  const values = queryValues(request, name);
  if (values.length === 0) return { guid: EMPTY_GUID };
  const attempted = values.join(",");
  const first = values[0]!;
  if (first.trim() === "") return { error: `The value '${attempted}' is invalid.` };
  const guid = parseGuid(first);
  return guid === null ? { error: `The value '${attempted}' is not valid.` } : { guid };
}

/** A GUID query parameter of a public action, or the old validation answer already sent (`undefined`). */
export function guidParameter(
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
): string | undefined {
  const bound = bindGuidQuery(request, name);
  if ("error" in bound) {
    void sendValidationProblem(reply, { [name]: [bound.error] });
    return undefined;
  }
  return bound.guid;
}

// eslint-disable-next-line no-control-regex -- the contract's pattern names control characters
const CLIENT_ID = /^[^/\\#?\u0000-\u001f\u007f-\u009f]+$/;

/** Whether Studio can hold the client ID (the contract's `ClientId`: 1–256 characters, no `/ \ # ?` or controls). */
export function isStudioClientId(clientId: string): boolean {
  return CLIENT_ID.test(clientId) && [...clientId].length <= 256;
}

/** The form fields of each request with a form body, read once. */
const forms = new WeakMap<FastifyRequest, Promise<FormData | null>>();

/**
 * The fields of a form body (`application/x-www-form-urlencoded` or `multipart/form-data`), as
 * the actions' body parser collected it; `null` without one, or for one that cannot be read
 * (its fields then bind as missing).
 */
function formOf(request: FastifyRequest): Promise<FormData | null> {
  let form = forms.get(request);
  if (form === undefined) {
    form = readForm(request);
    forms.set(request, form);
  }
  return form;
}

async function readForm(request: FastifyRequest): Promise<FormData | null> {
  const contentType = request.headers["content-type"] ?? "";
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded" && type !== "multipart/form-data") return null;
  const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  try {
    const view = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length);
    return await new Response(view, { headers: { "content-type": contentType } }).formData();
  } catch (error) {
    request.log.info({ err: error }, "unreadable form");
    return null;
  }
}

/**
 * A simple parameter of the access-key actions as the old API bound it: from a form body first,
 * then the route's `{id}` segment (for `id`), then the query; the name in any letter case, the
 * first value. `undefined` when none has it.
 */
export async function boundValue(
  request: FastifyRequest,
  name: string,
): Promise<string | undefined> {
  const wanted = name.toLowerCase();
  const form = await formOf(request);
  if (form !== null) {
    for (const [field, value] of form) {
      if (field.toLowerCase() === wanted && typeof value === "string") return value;
    }
  }
  if (wanted === "id") {
    const { id } = (request.params ?? {}) as { id?: string };
    if (id !== undefined) return id;
  }
  return queryValues(request, name)[0];
}

/** A GUID parameter bound as {@link boundValue}: missing or malformed binds as {@link EMPTY_GUID}. */
export async function boundGuid(request: FastifyRequest, name: string): Promise<string> {
  const text = await boundValue(request, name);
  return (text === undefined ? null : parseGuid(text)) ?? EMPTY_GUID;
}

/** A boolean parameter bound as {@link boundValue}: `true` in any letter case, anything else `false`. */
export async function boundBool(request: FastifyRequest, name: string): Promise<boolean> {
  return (await boundValue(request, name))?.trim().toLowerCase() === "true";
}
