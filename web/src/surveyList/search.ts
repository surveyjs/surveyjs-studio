export interface SurveyListSearch {
  project?: string;
  archived?: boolean;
}

export interface SurveyListParams {
  project: string;
  archived: boolean;
}

const PERSONAL = "personal";
const MAX_PROJECT_LENGTH = 64;

function parseProject(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  // Project ids are GUIDs, which are case-insensitive; the server and the cache use lower case.
  return trimmed.length >= 1 && trimmed.length <= MAX_PROJECT_LENGTH
    ? trimmed.toLowerCase()
    : undefined;
}

function parseArchived(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

/** Cleans the raw URL search: invalid members are dropped, valid ones are kept as given. */
export function validateSurveyListSearch(raw: Record<string, unknown>): SurveyListSearch {
  const search: SurveyListSearch = {};
  const project = parseProject(raw.project);
  if (project !== undefined) search.project = project;
  const archived = parseArchived(raw.archived);
  if (archived !== undefined) search.archived = archived;
  return search;
}

/** The list's parameters with defaults applied. */
export function surveyListParams(search: SurveyListSearch): SurveyListParams {
  return { project: search.project ?? PERSONAL, archived: search.archived ?? false };
}

/** Search for a link to a list: defaults are omitted, so Active personal is plain `/`. */
export function surveyListSearch(params: SurveyListParams): SurveyListSearch {
  const search: SurveyListSearch = {};
  if (params.project !== PERSONAL) search.project = params.project;
  if (params.archived) search.archived = true;
  return search;
}
