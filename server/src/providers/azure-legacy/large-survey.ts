import type { LegacyTable, RawTableEntity } from "./fixtures.js";

/**
 * The generated results of fixture survey "API created" (Step 9): 1,500 responses for paging,
 * Summary and Table checks, written as code so no 1,500-row JSON file is committed. Pure: no I/O.
 * `readLegacyFixtures` appends `largeSurveyTable()`, so every provider sees the same rows. The
 * expectations of the provider suite are written by hand and do not use these helpers.
 */

export const LARGE_SURVEY_ID = "22222222-0000-4000-8000-a00000000008";
export const LARGE_SURVEY_POST_ID = "33333333-0000-4000-8000-a00000000008";
/** The results table of the survey: `post` and the post id without dashes. */
export const LARGE_SURVEY_TABLE = "post33333333000040008000a00000000008";
export const LARGE_SURVEY_RESPONSES = 1500;

const START = Date.parse("2026-05-01T08:00:00.000Z");
const MINUTE = 60_000;

const hex11 = (n: number): string => n.toString(16).padStart(11, "0");

/** The response id (and row key) of response `n`, 1 to 1,500. */
export const largeSurveyResponseId = (n: number): string => `66666666-0000-4000-8000-c${hex11(n)}`;

/** Two responses share each minute, so page boundaries fall inside a tie. */
export const largeSurveySubmittedAt = (n: number): string =>
  new Date(START + Math.floor(n / 2) * MINUTE).toISOString();

/** The answers of response `n`, in the key order the stored text has. */
export function largeSurveyAnswers(n: number): Record<string, unknown> {
  const channels = [["Search"], ["Friend"], ["Search", "Social"], ["Ad"]];
  return {
    color: ["Red", "Green", "Blue"][(n - 1) % 3],
    score: ((n - 1) % 5) + 1,
    subscribe: n % 4 === 0,
    channels: channels[(n - 1) % 4],
    ...(n % 10 === 0 && { comment: `Comment ${String(n)}` }),
  };
}

function largeSurveyEntity(n: number): RawTableEntity {
  const id = largeSurveyResponseId(n);
  return {
    PartitionKey: "*",
    RowKey: id,
    "id@odata.type": "Edm.Guid",
    id,
    type: "SURVEY_POSTRESUTL",
    "happendat@odata.type": "Edm.DateTime",
    happendat: largeSurveySubmittedAt(n),
    "surveyid@odata.type": "Edm.Guid",
    // The legacy writer stores an unrelated GUID here, as the hand-written fixtures do.
    surveyid: `77777777-0000-4000-8000-c${hex11(n)}`,
    "postid@odata.type": "Edm.Guid",
    postid: LARGE_SURVEY_POST_ID,
    result: JSON.stringify(largeSurveyAnswers(n)),
  };
}

/** The results table of the survey, entities in response order. */
export function largeSurveyTable(): LegacyTable {
  return {
    account: "results",
    name: LARGE_SURVEY_TABLE,
    entities: Array.from({ length: LARGE_SURVEY_RESPONSES }, (_, index) =>
      largeSurveyEntity(index + 1),
    ),
  };
}
