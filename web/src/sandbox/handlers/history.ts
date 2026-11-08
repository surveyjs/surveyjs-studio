// History entries of the sandbox. As on the server, an entry keeps the definition it saved, but only
// the newest HISTORY_SNAPSHOTS entries of a survey keep it (ADR 0030): the editor saves after nearly
// every change, and a full copy per save would fill the browser storage in one editing session.
// Older entries stay in the list without their JSON; reading one answers 501 (getSurveyHistoryEntry).
import type { SandboxHistoryEntry, SandboxJson } from "../seed-types";
import type { SandboxData } from "../store";
import { compare } from "./common";

/** How many of a survey's newest history entries keep the definition they saved. */
export const HISTORY_SNAPSHOTS = 20;

/** `at` descending, then id descending (code-point order of the lower-case ids): `historyOrder`. */
export const historyOrder = (
  a: { at: string; id: string },
  b: { at: string; id: string },
): number => Date.parse(b.at) - Date.parse(a.at) || compare(b.id, a.id);

/** Adds an entry with a copy of `definition`, then drops the JSON of entries past the newest few. */
export function addHistoryEntry(
  data: SandboxData,
  surveyId: string,
  entry: { id: string; at: string; userId: string | null },
  definition: SandboxJson,
): void {
  const entries = (data.history[surveyId] ??= []);
  entries.push({ ...entry, snapshot: structuredClone(definition) });
  pruneSnapshots(entries);
}

/** Keeps `snapshot` on the newest HISTORY_SNAPSHOTS entries only. */
export function pruneSnapshots(entries: SandboxHistoryEntry[]): void {
  [...entries]
    .sort(historyOrder)
    .slice(HISTORY_SNAPSHOTS)
    .forEach((entry) => delete entry.snapshot);
}
