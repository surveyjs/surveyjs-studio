// The checks of the survey operations' inputs: what the server's contract validation and
// server/src/surveys/service.ts refuse before the stored data is read. The sandbox code does not
// import server/src.
import { checkName, checkProjectId, failOn, isRecord, parseLimit, requiredObject } from "./common";
import { MAX_NAME_UNITS } from "./naming";
import {
  badRequest,
  validationFailed,
  type ProblemError,
  type ProblemFieldError,
} from "./problems";
import { PERSONAL } from "./survey-access";

export function checkSettings(value: unknown, errors: ProblemFieldError[]): void {
  if (!isRecord(value)) {
    errors.push({ pointer: "/settings", detail: "must be object" });
    return;
  }
  for (const key of ["publicResults", "storeRespondentIp"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      errors.push({ pointer: `/settings/${key}`, detail: "must be boolean" });
    }
  }
  const names = value["privateResultQuestions"];
  if (names === undefined) return;
  const pointer = "/settings/privateResultQuestions";
  if (!Array.isArray(names)) {
    errors.push({ pointer, detail: "must be array" });
  } else if (names.length > 1000) {
    errors.push({ pointer, detail: "must NOT have more than 1000 items" });
  } else {
    names.forEach((name: unknown, index) => {
      if (typeof name !== "string" || name.length === 0 || [...name].length > 256) {
        errors.push({
          pointer: `${pointer}/${index}`,
          detail: "must be a string of 1 to 256 characters",
        });
      }
    });
    if (new Set(names).size !== names.length) {
      errors.push({ pointer, detail: "must NOT have duplicate items" });
    }
  }
}

/** What the contract schema cannot check about a name: blank, or too long in UTF-16 units. */
export function nameProblem(name: unknown): ProblemError | null {
  if (typeof name !== "string") return null;
  const detail =
    name.trim() === ""
      ? "must not be blank"
      : name.length > MAX_NAME_UNITS
        ? `must NOT be longer than ${MAX_NAME_UNITS} UTF-16 code units`
        : null;
  return detail === null ? null : validationFailed([{ pointer: "/name", detail }]);
}

/** The fields of a `createSurvey` or `cloneSurvey` body, checked. */
export interface NewSurveyFields {
  name: string | undefined;
  projectId: string | null | undefined;
  /** `createSurvey` only. */
  definition: Record<string, unknown> | undefined;
}

/**
 * Checks the optional body of `createSurvey` (`withDefinition`) or `cloneSurvey`: `name` and
 * `projectId`, and for a create `definition`. A schema problem is `422` with every field error;
 * then a blank or too long name is `422` on its own.
 */
export function newSurveyFields(raw: unknown, withDefinition: boolean): NewSurveyFields {
  const body = raw === undefined ? {} : requiredObject(raw);
  const errors: ProblemFieldError[] = [];
  if (body["name"] !== undefined) checkName(body["name"], errors);
  if (body["projectId"] !== undefined) checkProjectId(body["projectId"], errors);
  const definition = withDefinition ? body["definition"] : undefined;
  if (definition !== undefined && !isRecord(definition)) {
    errors.push({ pointer: "/definition", detail: "must be object" });
  }
  failOn(errors);
  const invalid = nameProblem(body["name"]);
  if (invalid) throw invalid;
  return {
    name: body["name"] as string | undefined,
    projectId: body["projectId"] as string | null | undefined,
    definition: definition as Record<string, unknown> | undefined,
  };
}

export interface SurveyListQuery {
  project: string;
  archived: boolean;
  limit: number;
  cursor: string | undefined;
}

export function parseListQuery(url: URL): SurveyListQuery {
  const errors: ProblemFieldError[] = [];
  const params = url.searchParams;
  const archivedText = params.get("archived");
  if (archivedText !== null && archivedText !== "true" && archivedText !== "false") {
    errors.push({ pointer: "/archived", detail: "must be boolean" });
  }
  const limit = parseLimit(params, errors);
  if (errors.length > 0) throw badRequest(undefined, errors);
  return {
    project: params.get("project") ?? PERSONAL,
    archived: archivedText === "true",
    limit,
    cursor: params.get("cursor") ?? undefined,
  };
}
