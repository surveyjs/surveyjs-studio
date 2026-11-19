import type { CompletionState, SurveyRecord, SurveyResponse } from "../domain/types.js";
import { responseOrder } from "./ordering.js";
import { foldRuns, pageOfFoldedRuns, responseOfRun } from "./runs.js";
import type { ResultStore } from "./types.js";
import { GUID } from "../domain/guid.js";

export interface MemoryResultsSeed {
  /** Responses by survey id. */
  readonly responses?: Record<string, readonly SurveyResponse[]>;
  /** Completion markers by survey id, then client id. */
  readonly completions?: Record<string, Record<string, { partial: boolean }>>;
}

export interface MemoryResultStore {
  readonly store: ResultStore;
  /** Forgets the survey's responses and markers (called by `deleteSurvey`). */
  dropSurvey(surveyId: string): void;
}

/** Responses and completion markers in process memory, like all memory data. */
export function createMemoryResultStore(seed: MemoryResultsSeed = {}): MemoryResultStore {
  const responses = new Map<string, Map<string, SurveyResponse>>();
  const markers = new Map<string, Map<string, { partial: boolean }>>();
  for (const [surveyId, rows] of Object.entries(seed.responses ?? {})) {
    responses.set(
      surveyId.toLowerCase(),
      new Map(
        rows.map((r) => [r.id.toLowerCase(), { ...structuredClone(r), id: r.id.toLowerCase() }]),
      ),
    );
  }
  for (const [surveyId, byClient] of Object.entries(seed.completions ?? {})) {
    markers.set(surveyId.toLowerCase(), new Map(Object.entries(structuredClone(byClient))));
  }

  const sorted = (survey: SurveyRecord): SurveyResponse[] =>
    [...(responses.get(survey.id.toLowerCase())?.values() ?? [])].sort(responseOrder);

  const mark = (survey: SurveyRecord, clientId: string, partial: boolean): void => {
    const key = survey.id.toLowerCase();
    const byClient = markers.get(key) ?? new Map<string, { partial: boolean }>();
    byClient.set(clientId, { partial });
    markers.set(key, byClient);
  };

  const forget = (surveyId: string): void => {
    responses.delete(surveyId.toLowerCase());
    markers.delete(surveyId.toLowerCase());
  };

  const store: ResultStore = {
    appendResponse: (survey, response) => {
      if (!GUID.test(response.id)) {
        return Promise.reject(new Error("The response id is not a GUID"));
      }
      const id = response.id.toLowerCase();
      const key = survey.id.toLowerCase();
      const rows = responses.get(key) ?? new Map<string, SurveyResponse>();
      const exists = rows.has(id);
      if (!exists) {
        rows.set(id, {
          id,
          submittedAt: response.submittedAt,
          data: structuredClone(response.data),
          ...(response.clientId !== undefined && { clientId: response.clientId }),
          ...(response.respondentIp !== undefined && { respondentIp: response.respondentIp }),
          partial: response.partial === true && response.clientId !== undefined,
        });
        responses.set(key, rows);
      }
      if (response.clientId !== undefined)
        mark(survey, response.clientId, response.partial === true);
      return Promise.resolve(exists ? "exists" : "stored");
    },
    hasResponse: (survey, id) =>
      Promise.resolve(
        GUID.test(id) && (responses.get(survey.id.toLowerCase())?.has(id.toLowerCase()) ?? false),
      ),
    listResponses: (survey) => Promise.resolve(structuredClone(sorted(survey))),
    stats: (survey) => {
      const rows = sorted(survey).filter((row) => !row.partial);
      return Promise.resolve({
        count: rows.length,
        firstSubmittedAt: rows[0]?.submittedAt ?? null,
        lastSubmittedAt: rows.at(-1)?.submittedAt ?? null,
      });
    },
    hasPartial: (survey) =>
      Promise.resolve(
        [...(markers.get(survey.id.toLowerCase())?.values() ?? [])].some((m) => m.partial),
      ),
    listResponsePage: (survey, query) => {
      const { runs, next } = pageOfFoldedRuns(foldRuns(sorted(survey)), query);
      return Promise.resolve({ items: runs.map(responseOfRun), next });
    },
    completion: (survey, clientId): Promise<CompletionState> => {
      const found = markers.get(survey.id.toLowerCase())?.get(clientId);
      return Promise.resolve(
        found === undefined ? "none" : found.partial ? "partial" : "completed",
      );
    },
    deleteAll: (survey) => {
      forget(survey.id);
      return Promise.resolve();
    },
  };

  return {
    store,
    dropSurvey: forget,
  };
}
