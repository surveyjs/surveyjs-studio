// What the run page changes in a published definition before the Form Library reads it.
import type { PublishedSurvey } from "../api/public";

export type SurveyDefinition = PublishedSurvey["definition"];

/** Question types whose answers are files: the File Upload and the Signature Pad. */
const FILE_TYPES = new Set(["file", "signaturepad"]);

const isFileType = (value: unknown): boolean => typeof value === "string" && FILE_TYPES.has(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A column's cell type: its own, or the matrix's when it has none (or `default`). */
const cellTypeOf = (column: Record<string, unknown>, matrixCellType: unknown): unknown =>
  column.cellType === undefined || column.cellType === "default" ? matrixCellType : column.cellType;

function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue);
  if (!isObject(value)) return value;
  const copy = Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, copyValue(member)]),
  );
  if (isFileType(copy.type)) copy.storeDataAsText = false;
  if (Array.isArray(copy.columns)) {
    copy.columns = copy.columns.map((column: unknown) =>
      isObject(column) && isFileType(cellTypeOf(column, copy.cellType))
        ? { ...column, storeDataAsText: false }
        : column,
    );
  }
  return copy;
}

/**
 * A deep copy of `definition` where every File Upload and Signature Pad question, at any depth
 * (panels, dynamic panels' `templateElements`, matrix columns of a file `cellType`), stores its
 * files on the server (`storeDataAsText: false`): only then does the Form Library hand them to
 * `onUploadFiles` instead of keeping them as base64 text in the answers (S20).
 */
export function withServerFileStorage(definition: SurveyDefinition): SurveyDefinition {
  return copyValue(definition) as SurveyDefinition;
}

/**
 * Top-level properties of the old SurveyJS service that the Form Library still acts on:
 * `surveyId` loads the definition from it, `surveyPostId` also posts the answers to it, and
 * `clientId` goes with them. The run page loads and stores surveys itself.
 */
const SERVICE_PROPERTIES = ["surveyId", "surveyPostId", "clientId"] as const;

/**
 * The definition the run page gives the Form Library: `withServerFileStorage`, without the old
 * service's properties, and with `cookieName` set to `runCookieName`'s token (`null`: no limit, no
 * `cookieName`). The library writes `{cookieName}=true` itself on completion.
 */
export function forRunPage(
  definition: SurveyDefinition,
  cookieName: string | null,
): SurveyDefinition {
  const copy = withServerFileStorage(definition);
  for (const property of SERVICE_PROPERTIES) delete copy[property];
  if (cookieName === null) delete copy.cookieName;
  else copy.cookieName = cookieName;
  return copy;
}

/**
 * The cookie of "Limit to one response": the definition's non-empty string `cookieName` (the
 * server sets it to the survey id when the legacy setting is on), else null (no limit).
 */
export function limitCookieOf(definition: SurveyDefinition): string | null {
  const { cookieName } = definition;
  return typeof cookieName === "string" && cookieName !== "" ? cookieName : null;
}
