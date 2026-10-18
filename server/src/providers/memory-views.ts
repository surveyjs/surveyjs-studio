import type { ViewName, ViewState } from "../domain/types.js";
import type { ViewStore } from "./types.js";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The marker of a reset view: `getView` answers null for it, even where a legacy state exists. */
const RESET = Symbol("reset");

export interface MemoryViewsSeed {
  /** The legacy per-survey layouts by survey id: the fallback until a user saves or resets. */
  readonly legacyViews?: Record<string, Partial<Record<ViewName, ViewState>>>;
}

export interface MemoryViewStore {
  readonly store: ViewStore;
  /** Forgets every user's views and markers of the survey (called by `deleteSurvey`). */
  dropSurvey(surveyId: string): void;
}

/** Saved results layouts in process memory, like all memory data. */
export function createMemoryViewStore(seed: MemoryViewsSeed = {}): MemoryViewStore {
  const saved = new Map<string, Map<string, ViewState | typeof RESET>>();
  const legacy = new Map(
    Object.entries(seed.legacyViews ?? {}).map(([surveyId, views]) => [
      surveyId.toLowerCase(),
      structuredClone(views),
    ]),
  );

  const entryKey = (userId: string, view: ViewName): string => `${userId.toLowerCase()}/${view}`;

  const write = (
    surveyId: string,
    userId: string,
    view: ViewName,
    value: ViewState | typeof RESET,
  ): Promise<void> => {
    if (!GUID.test(surveyId) || !GUID.test(userId)) {
      return Promise.reject(new Error("View ids must be GUIDs"));
    }
    const key = surveyId.toLowerCase();
    const entries = saved.get(key) ?? new Map<string, ViewState | typeof RESET>();
    entries.set(entryKey(userId, view), value);
    saved.set(key, entries);
    return Promise.resolve();
  };

  const store: ViewStore = {
    getView: (surveyId, userId, view) => {
      if (!GUID.test(surveyId) || !GUID.test(userId)) return Promise.resolve(null);
      const own = saved.get(surveyId.toLowerCase())?.get(entryKey(userId, view));
      if (own === RESET) return Promise.resolve(null);
      const state = own ?? legacy.get(surveyId.toLowerCase())?.[view];
      return Promise.resolve(state === undefined ? null : structuredClone(state));
    },
    saveView: (surveyId, userId, view, state) =>
      write(surveyId, userId, view, structuredClone(state)),
    resetView: (surveyId, userId, view) => write(surveyId, userId, view, RESET),
  };

  return { store, dropSurvey: (surveyId) => void saved.delete(surveyId.toLowerCase()) };
}
