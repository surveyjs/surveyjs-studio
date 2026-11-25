import { createHash } from "node:crypto";
import { isGuid } from "../providers/azure-legacy/mapping.js";
import type { Report } from "./map/report.js";
import type { LegacySource } from "./source/index.js";

/** What a sample run copies, by lower-case ids. */
export interface SampleSet {
  readonly accounts: ReadonlySet<string>;
  readonly surveys: ReadonlySet<string>;
  readonly projects: ReadonlySet<string>;
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
 * A listed id that is no account is reported and left out.
 */
export async function selectSample(
  source: LegacySource,
  share: number,
  include: readonly string[],
  report?: Report,
): Promise<{ accounts: Set<string>; surveys: Set<string>; projects: Set<string> }> {
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

  const organizations = new Set<string>();
  for await (const row of source.organizations()) organizations.add(row.id.toLowerCase());
  const withMembers = new Set<string>();
  const projects = new Set<string>();
  for await (const row of source.organizationUsers()) {
    const projectId = row.organizationid.toLowerCase();
    if (!organizations.has(projectId) || !isGuid(row.userid)) continue;
    withMembers.add(projectId);
    if (accounts.has(row.userid.toLowerCase())) projects.add(projectId);
  }

  const surveys = new Set<string>();
  for await (const row of source.surveys()) {
    const owner = row.userid?.toLowerCase() ?? "";
    const creator = row.creatorid?.toLowerCase() ?? "";
    const orphan = !users.has(owner) && !withMembers.has(owner);
    if (accounts.has(owner) || projects.has(owner) || (orphan && accounts.has(creator))) {
      surveys.add(row.id.toLowerCase());
    }
  }
  return { accounts, surveys, projects };
}
