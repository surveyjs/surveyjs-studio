export interface HistoryProbe {
  surveyId: string;
  /** The page's final address; only its origin and path are kept. */
  finalUrl: string;
  status: number | null;
  heading: string;
  entries: number;
  screenshot: string;
}

/** The address without query string or fragment (they can carry keys). */
export function originAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(unreadable address)";
  }
}

export function trimHeading(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

/** The problem line for a History page with too few entries; it holds no key, cookie or query. */
export function historyProblem(probe: HistoryProbe, expected: number, fix: string): string {
  const status = probe.status === null ? "none" : String(probe.status);
  return (
    `History: ${probe.entries} entries, expected at least ${expected} ` +
    `(survey id ${probe.surveyId}, page ${originAndPath(probe.finalUrl)}, status ${status}, ` +
    `h1 "${trimHeading(probe.heading)}", screenshot ${probe.screenshot}): ${fix}`
  );
}
