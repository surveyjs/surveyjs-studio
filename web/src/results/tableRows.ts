/** What the table and the charts read of a response (a `SurveyResponse` is one; so is a public item). */
export interface ResultItem {
  readonly submittedAt: string;
  readonly data: Record<string, unknown>;
  readonly respondentIp?: string;
}

export const SUBMITTED_COLUMN = "HappendAt";
export const IP_COLUMN = "IPAddress";

/** One table row per response: its answers plus the submission time and, when stored, the IP. */
export function tableRows(
  responses: readonly ResultItem[],
  questionNames: ReadonlySet<string>,
): Record<string, unknown>[] {
  return responses.map((response) => {
    const row: Record<string, unknown> = { ...response.data };
    if (!questionNames.has(SUBMITTED_COLUMN)) row[SUBMITTED_COLUMN] = response.submittedAt;
    if (response.respondentIp !== undefined && !questionNames.has(IP_COLUMN)) {
      row[IP_COLUMN] = response.respondentIp;
    }
    return row;
  });
}

/** The columns after the answer columns; a question with the same name keeps its own column. */
export function extraTableColumns(
  responses: readonly ResultItem[],
  questionNames: ReadonlySet<string>,
) {
  const columns: { name: string; displayName: string; isVisible: boolean }[] = [];
  if (!questionNames.has(SUBMITTED_COLUMN)) {
    columns.push({ name: SUBMITTED_COLUMN, displayName: "Submitted", isVisible: true });
  }
  if (
    !questionNames.has(IP_COLUMN) &&
    responses.some((response) => response.respondentIp !== undefined)
  ) {
    columns.push({ name: IP_COLUMN, displayName: IP_COLUMN, isVisible: true });
  }
  return columns;
}

/** What the Summary charts read: the answers only. */
export const summaryData = (responses: readonly ResultItem[]) =>
  responses.map((response) => response.data);
