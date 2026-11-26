import { createHash } from "node:crypto";
import type { LegacyOrganizationUserRow } from "../providers/azure-legacy/rows.js";
import { mapProject } from "./map/projects.js";
import { createReport, type Report } from "./map/report.js";
import type { LegacySource } from "./source/index.js";

/** What a sample run copies, by lower-case ids. */
export interface SampleSet {
  readonly accounts: ReadonlySet<string>;
  readonly surveys: ReadonlySet<string>;
  readonly projects: ReadonlySet<string>;
  /**
   * What picked it: the share and the listed ids (lower-case, sorted, each once). The sets grow as
   * the source does; the selection does not, so the commands compare it with the copy's.
   */
  readonly selection?: SampleSelection;
}
export interface SampleSelection {
  readonly share: number;
  readonly include: readonly string[];
}

/**
 * Whether an account falls in the share: the first 32 bits of the SHA-256 of its lower-case id,
 * as a fraction of 2^32, below the share. The same id always gives the same answer.
 */
export function inSampleShare(accountId: string, share: number): boolean {
  const hash = createHash("sha256").update(accountId.toLowerCase()).digest("hex");
  return parseInt(hash.slice(0, 8), 16) / 2 ** 32 < share;
}

/**
 * Whole accounts (design, The sample): every account in the share and every listed one, with
 * - the account's personal surveys (a survey of a missing or member-less project counts as its
 *   creator's, as the copy moves it there);
 * - every project it is a member of, with the project's surveys (its members get profiles in
 *   the copy, their own surveys are not pulled in: not transitive).
 * Members and member-less projects are the copy's own (`mapProject`): a row with a role the copy
 * does not keep makes nobody a member. A listed id that is no account is reported and left out.
 */
export async function selectSample(
  source: LegacySource,
  share: number,
  include: readonly string[],
  report?: Report,
): Promise<{
  accounts: Set<string>;
  surveys: Set<string>;
  projects: Set<string>;
  selection: SampleSelection;
}> {
  const users = new Set<string>();
  const accounts = new Set<string>();
  for await (const row of source.users()) {
    const id = row.id.toLowerCase();
    users.add(id);
    if (inSampleShare(id, share)) accounts.add(id);
  }
  for (const raw of include) {
    const id = raw.trim().toLowerCase();
    if (id === "") continue;
    if (users.has(id)) accounts.add(id);
    else report?.note("sample_include_unknown", { accountId: id });
  }

  const membersOf = new Map<string, LegacyOrganizationUserRow[]>();
  for await (const row of source.organizationUsers()) {
    const projectId = row.organizationid.toLowerCase();
    const rows = membersOf.get(projectId);
    if (rows) rows.push(row);
    else membersOf.set(projectId, [row]);
  }
  /** The projects the copy keeps (with a member it keeps); the rest move their surveys. */
  const kept = new Set<string>();
  const projects = new Set<string>();
  for await (const row of source.organizations()) {
    const projectId = row.id.toLowerCase();
    // The copy reports what it skips; the selection only needs the outcome.
    const mapped = mapProject(row, membersOf.get(projectId) ?? [], createReport());
    if (mapped === null) continue;
    kept.add(projectId);
    if (mapped.members.some(({ userId }) => accounts.has(userId))) projects.add(projectId);
  }

  const surveys = new Set<string>();
  for await (const row of source.surveys()) {
    const owner = row.userid?.toLowerCase() ?? "";
    const creator = row.creatorid?.toLowerCase() ?? "";
    const orphan = !users.has(owner) && !kept.has(owner);
    if (accounts.has(owner) || projects.has(owner) || (orphan && accounts.has(creator))) {
      surveys.add(row.id.toLowerCase());
    }
  }
  const listed = [...new Set(include.map((raw) => raw.trim().toLowerCase()))];
  const selection = { share, include: listed.filter((one) => one !== "").sort() };
  return { accounts, surveys, projects, selection };
}

/** The `sample` state a copy writes: its sets and its selection; null for a full copy. */
export interface StoredSample {
  accounts: string[];
  surveys: string[];
  projects: string[];
  selection?: SampleSelection;
}

export const storedSampleOf = (sample: SampleSet | undefined): StoredSample | null =>
  sample
    ? {
        accounts: [...sample.accounts].sort(),
        surveys: [...sample.surveys].sort(),
        projects: [...sample.projects].sort(),
        ...(sample.selection && { selection: sample.selection }),
      }
    : null;

/**
 * Why a command's `--sample`/`--include` do not fit the copy's (the `sample` state; null: a full
 * copy); null when they do. A sample command on a full target would remove or compare everything
 * outside the sample; a full command on a sample target would grow it into a full copy.
 */
export function sampleMismatch(
  stored: StoredSample | null,
  sample: SampleSet | undefined,
): string | null {
  const describe = (s: StoredSample) =>
    s.selection
      ? `--sample ${s.selection.share} with ${s.selection.include.length} included accounts`
      : `a sample of ${s.accounts.length} accounts`;
  if (stored === null) {
    return sample ? "the target holds a full copy: run without --sample and --include" : null;
  }
  if (!sample)
    return `the target holds a sample (${describe(stored)}): pass the copy's --sample and --include`;
  const same =
    stored.selection && sample.selection
      ? stored.selection.share === sample.selection.share &&
        stored.selection.include.join(",") === sample.selection.include.join(",")
      : stored.accounts.join(",") === [...sample.accounts].sort().join(",");
  return same
    ? null
    : `the target holds another sample (${describe(stored)}): pass the copy's --sample and --include`;
}
