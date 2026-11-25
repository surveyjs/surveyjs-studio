import { parseArgs } from "node:util";

/** The size of a synthetic data set (`pnpm scale:generate`). */
export interface ScaleSizes {
  readonly users: number; // --users
  readonly surveys: number; // --surveys, spread over the users
  readonly responses: number; // --responses, spread over the surveys except the largest
  readonly largest: number; // --largest: responses of one survey, owned by the first user
  readonly historyPerSurvey: number; // --history, default 20
  readonly seed: number; // --seed, default 1
}

export const GENERATE_USAGE =
  "usage: scale:generate [--users <n>] [--surveys <n>] [--responses <n>] [--largest <n>] [--history <n>] [--seed <n>]";

const DEFAULTS = {
  users: 10,
  surveys: 100,
  responses: 10_000,
  largest: 10_000,
  history: 20,
  seed: 1,
};

const count = (text: string | undefined, fallback: number, min: number): number | null => {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min ? value : null;
};

/** The sizes the arguments name, or the usage problem. */
export function parseSizes(
  args: readonly string[],
): { readonly sizes: ScaleSizes } | { readonly error: string } {
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: [...args],
      options: {
        users: { type: "string" },
        surveys: { type: "string" },
        responses: { type: "string" },
        largest: { type: "string" },
        history: { type: "string" },
        seed: { type: "string" },
      },
    }).values;
  } catch (error) {
    return { error: (error as Error).message };
  }
  const users = count(values.users, DEFAULTS.users, 1);
  const surveys = count(values.surveys, DEFAULTS.surveys, 1);
  const responses = count(values.responses, DEFAULTS.responses, 0);
  const largest = count(values.largest, DEFAULTS.largest, 0);
  const historyPerSurvey = count(values.history, DEFAULTS.history, 0);
  const seed = count(values.seed, DEFAULTS.seed, 0);
  const bad = Object.entries({
    users,
    surveys,
    responses,
    largest,
    history: historyPerSurvey,
    seed,
  })
    .filter(([, v]) => v === null)
    .map(([k]) => `--${k}`);
  if (bad.length > 0)
    return { error: `${bad.join(", ")}: must be a whole number (users and surveys at least 1)` };
  return {
    sizes: {
      users: users!,
      surveys: surveys!,
      responses: responses!,
      largest: largest!,
      historyPerSurvey: historyPerSurvey!,
      seed: seed!,
    },
  };
}
