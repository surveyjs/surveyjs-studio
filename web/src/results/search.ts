export const RESULTS_TABS = ["summary", "table", "details"] as const;
export type ResultsTab = (typeof RESULTS_TABS)[number];
export interface ResultsSearch {
  tab?: ResultsTab;
}

/** Keeps `tab` only when it is exactly one of the tabs; every other member is dropped. */
export function validateResultsSearch(raw: Record<string, unknown>): ResultsSearch {
  const tab = RESULTS_TABS.find((candidate) => candidate === raw.tab);
  return tab === undefined ? {} : { tab };
}

export const resultsTab = (search: ResultsSearch): ResultsTab => search.tab ?? "summary";

/** The summary is the default and stays out of the URL. */
export const resultsSearch = (tab: ResultsTab): ResultsSearch => (tab === "summary" ? {} : { tab });
