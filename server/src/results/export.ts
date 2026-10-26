import type { components } from "@surveyjs-studio/contract";
import type { SurveyRecord, SurveyResponse } from "../domain/types.js";
import type { ResponsePage, ResultStore } from "../providers/types.js";
import { CSV_BOM, csvHeader, csvRow, type CsvColumn } from "./csv.js";

export type SurveyResponseJson = components["schemas"]["SurveyResponse"];

/** Rows per store read of an export: the largest `listResults` page (R5). */
export const EXPORT_PAGE_SIZE = 1000;

/** A response as `listResults` and the JSON export return it: no `partial` (Step 9 R1). */
export function responseJson(response: SurveyResponse): SurveyResponseJson {
  return {
    id: response.id,
    submittedAt: response.submittedAt,
    data: response.data,
    ...(response.clientId !== undefined && { clientId: response.clientId }),
    ...(response.respondentIp !== undefined && { respondentIp: response.respondentIp }),
  };
}

/**
 * Every stored response of the survey in submission order, page by page (R5). The first page is read
 * before this resolves, so a store failure there rejects it while an error answer is still possible.
 */
export async function storedResponses(
  results: ResultStore,
  survey: SurveyRecord,
): Promise<AsyncIterable<SurveyResponse>> {
  const first = await results.listResponsePage(survey, { limit: EXPORT_PAGE_SIZE });
  return (async function* () {
    let page: ResponsePage = first;
    for (;;) {
      yield* page.items;
      if (page.next === null) return;
      page = await results.listResponsePage(survey, { limit: EXPORT_PAGE_SIZE, after: page.next });
    }
  })();
}

/** The JSON export (R4): an array of `SurveyResponse` items, written as the rows are read. */
export async function* jsonExport(
  responses: AsyncIterable<SurveyResponse>,
): AsyncGenerator<string> {
  let separator = "[";
  for await (const response of responses) {
    yield separator + JSON.stringify(responseJson(response));
    separator = ",";
  }
  yield separator === "[" ? "[]" : "]";
}

/** The CSV export (R3): BOM and header, then one record per response. */
export async function* csvExport(
  columns: readonly CsvColumn[],
  responses: AsyncIterable<SurveyResponse>,
): AsyncGenerator<string> {
  yield CSV_BOM + csvHeader(columns);
  for await (const response of responses) yield csvRow(columns, response);
}
