// The classes of Studio's per-client-IP rate limits for the respondent-facing operations. app.ts
// builds its limits from this; the legacy replay paces its requests by it. No imports, so a
// script can load it without building the app.

export type RateLimitClass = "public" | "file" | "summary";

/** The respondent's operations, limited by `PUBLIC_RATE_LIMIT` per client IP and minute. */
const PUBLIC_OPERATIONS: ReadonlySet<string> = new Set([
  "getPublishedSurvey",
  "submitResponse",
  "uploadResponseFile",
  "getPublicResults",
  "getPublicDefinition",
  "getRespondentState",
  "getRespondentStateByResultId",
  "submitResponseByPostId",
  "uploadResponseFileByPostId",
  "getPublicLayout",
]);
/** File downloads: `PUBLIC_FILE_RATE_LIMIT`. */
const FILE_OPERATIONS: ReadonlySet<string> = new Set(["downloadFile", "getLegacyFile"]);
/** Each call reads every completed response of the survey, unless its summary is cached. */
const SUMMARY_OPERATIONS: ReadonlySet<string> = new Set(["getQuestionSummary"]);

/** The limit class of an operation, or `null` when none of these three limits applies. */
export function rateLimitClassOf(operationId: string): RateLimitClass | null {
  if (PUBLIC_OPERATIONS.has(operationId)) return "public";
  if (FILE_OPERATIONS.has(operationId)) return "file";
  if (SUMMARY_OPERATIONS.has(operationId)) return "summary";
  return null;
}

/** The operations of a class, in a fixed order. */
export function operationsOfRateLimitClass(limitClass: RateLimitClass): readonly string[] {
  const set = { public: PUBLIC_OPERATIONS, file: FILE_OPERATIONS, summary: SUMMARY_OPERATIONS }[
    limitClass
  ];
  return [...set];
}
