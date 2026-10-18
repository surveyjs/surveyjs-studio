export type ExportFormat = "json" | "csv";

/** The link that downloads every response of the survey (`GET .../results/export`). */
export function exportResultsUrl(apiBase: string, surveyId: string, format: ExportFormat): string {
  return `${apiBase}/surveys/${encodeURIComponent(surveyId)}/results/export?format=${format}`;
}

/** The public results page of the survey, for the "Go to the results page" link. */
export function publicResultsUrl(origin: string, surveyId: string): string {
  return `${origin}/results/${encodeURIComponent(surveyId)}`;
}
