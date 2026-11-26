/**
 * `plan`: what a copy would move, without writing anything: the volumes per entity, the stats
 * estimate (the measurements of `inspect:legacy --stats`), and with a sample its survey ids and
 * the hashes of its accounts' access keys (the replay's filter, ADR 0042). Ids and counts only;
 * the caller writes it where `--report` points.
 */
import { hashCredential } from "../credentials/format.js";
import { summariseStats, type StatsMeasurements, type StatsSummary } from "../legacy/stats.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";

export interface PlanVolumes {
  users: number;
  usersWithAccessKey: number;
  surveys: number;
  projects: number;
  members: number;
}

export interface PlanReport {
  volumes: PlanVolumes;
  /** The stats summary; null when the run measured nothing. */
  estimate: StatsSummary | null;
  sample: {
    accounts: number;
    projects: number;
    surveys: string[];
    /** `hashCredential(key, "legacy-key")` of each sample account's access key, sorted. */
    keyHashes: string[];
  } | null;
}

export interface PlanOptions {
  sample?: SampleSet;
  /** Reads the stores' counts and sizes (`measureLegacyStores`); none: no estimate. */
  measure?: () => Promise<StatsMeasurements>;
}

export async function runPlan(
  source: LegacySource,
  options: PlanOptions = {},
): Promise<PlanReport> {
  const { sample } = options;
  const volumes: PlanVolumes = {
    users: 0,
    usersWithAccessKey: 0,
    surveys: 0,
    projects: 0,
    members: 0,
  };
  const keyHashes: string[] = [];
  for await (const row of source.users()) {
    volumes.users += 1;
    const key = row.accesskey;
    if (key === null || key.trim() === "") continue;
    volumes.usersWithAccessKey += 1;
    // As the copy stores it (mapPeople): the key as stored, lower-cased by the hash.
    if (sample?.accounts.has(row.id.toLowerCase()))
      keyHashes.push(hashCredential(key, "legacy-key"));
  }
  volumes.surveys = await countOf(source.surveys());
  volumes.projects = await countOf(source.organizations());
  volumes.members = await countOf(source.organizationUsers());
  const estimate = options.measure ? summariseStats(await options.measure()) : null;
  return {
    volumes,
    estimate,
    sample: sample
      ? {
          accounts: sample.accounts.size,
          projects: sample.projects.size,
          surveys: [...sample.surveys].sort(),
          keyHashes: keyHashes.sort(),
        }
      : null,
  };
}

async function countOf(items: AsyncIterable<unknown>): Promise<number> {
  let count = 0;
  for await (const item of items) if (item !== undefined) count += 1;
  return count;
}
