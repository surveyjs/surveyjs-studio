// Parameters as the old API bound them: GUIDs in every form it parsed, query parameters with its
// validation texts, and the client IDs Studio can hold.
import type { FastifyRequest } from "fastify";
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

// eslint-disable-next-line no-control-regex -- the contract's pattern names control characters
const CLIENT_ID = /^[^/\\#?\u0000-\u001f\u007f-\u009f]+$/;

/** Whether Studio can hold the client ID (the contract's `ClientId`: 1–256 characters, no `/ \ # ?` or controls). */
export function isStudioClientId(clientId: string): boolean {
  return CLIENT_ID.test(clientId) && [...clientId].length <= 256;
}
