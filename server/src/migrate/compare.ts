/**
 * How `verify` compares what the two providers read: canonical JSON and its checksum, and the
 * source's reads with the mapping's decisions applied (the mappers decide; nothing here decides
 * again). Every normaliser takes the source provider's read and gives what the target should read.
 */
import { createHash } from "node:crypto";
import type {
  HistoryEntryRecord,
  ProjectMember,
  ProjectRecord,
  SurveyRecord,
  SurveyResponse,
  User,
} from "../domain/types.js";
import { createReport } from "./map/report.js";
import { mapHistory } from "./map/results.js";
import { withoutNul } from "./map/text.js";
import type { HistoryRec, KeyRec, MemberRec, PersonRec } from "./records.js";

/** JSON with every object's keys sorted, at any depth (array order kept). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return inner;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(inner).sort()) {
      sorted[key] = (inner as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/** SHA-256 (hex) of the canonical JSON. */
export const checksum = (value: unknown): string =>
  createHash("sha256")
    .update(canonicalJson(value) ?? "undefined")
    .digest("hex");

export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** The bytes' SHA-256 (hex). */
export const bytesChecksum = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A JSON value as the copy stores it (U+0000 as U+FFFD); the copy reported it already. */
export const storedJson = <T>(value: T): T => withoutNul(value, {}, createReport());

/**
 * The survey record the target should hold: the source provider's record with the mapper's
 * decisions (`mapped`, from `mapSurvey`): the owner (a survey of a missing or member-less project
 * moves to its creator), the creator, and public results (off when a hiding setting is unreadable).
 */
export const expectedRecord = (read: SurveyRecord, mapped: SurveyRecord): SurveyRecord => ({
  ...read,
  owner: mapped.owner,
  creatorId: mapped.creatorId,
  settings: { ...read.settings, publicResults: mapped.settings.publicResults },
});

/**
 * The history the target should hold, from the source's entries (newest first) and their
 * snapshots (null: none or unreadable), or their texts as stored (the published snapshot, which
 * the app does not read): the mapper keeps the 20 newest and skips a snapshot that is not a JSON
 * object.
 */
export const expectedHistory = (
  surveyId: string,
  entries: readonly (
    { entry: HistoryEntryRecord; snapshot: unknown } | { entry: HistoryEntryRecord; text: string }
  )[],
): HistoryRec[] =>
  mapHistory(
    surveyId,
    entries.map((item) =>
      "text" in item ? item : { entry: item.entry, text: JSON.stringify(item.snapshot) ?? "null" },
    ),
    createReport(),
  );

/** A history entry as both sides compare it: the entry and its snapshot's checksum. */
export const historyKey = (rec: {
  id: string;
  at: string;
  userId: string | null;
  snapshot: unknown;
}): string => canonicalJson([rec.id.toLowerCase(), rec.at, rec.userId, checksum(rec.snapshot)]);

/** A response as the target should read it: the answers as stored (U+0000 replaced). */
export const expectedResponse = (read: SurveyResponse): SurveyResponse => storedJson(read);

/**
 * The user the target should read for a pre-created person (`mapPeople`): the id and block flag
 * of the source's read, the email lower-case, a blank display name replaced by that email.
 */
export const expectedUser = (read: User, person: PersonRec): User => ({
  id: read.id.toLowerCase(),
  email: person.email,
  displayName: person.displayName,
  blocked: read.blocked,
});

/**
 * The sign-in identity the target should hold for a pre-created person, as the people decision
 * writes it with the profile: `surveyjs`, the id as subject, the profile's email, verified.
 */
export const expectedIdentities = (person: PersonRec) => [
  { provider: "surveyjs", subject: person.id, email: person.email, emailVerified: true },
];

/**
 * The legacy key the target should read: the mapper's key (`mapPeople`: the last four of the
 * lower-case key), stored unrevoked (`revoked_at` null); none when no key is copied.
 */
export const expectedKey = (
  key: KeyRec | undefined,
): { lastFour: string; revoked: boolean } | null =>
  key ? { lastFour: key.lastFour, revoked: false } : null;

/** The project the target should read: one membership per (project, user), as the mapper merges. */
export const expectedProject = (
  read: ProjectRecord,
  members: readonly MemberRec[],
): ProjectRecord => ({
  ...read,
  memberCount: members.length,
});

/** The target's members as compared: `{userId}:{role}`, sorted. */
export const memberKeys = (members: readonly ProjectMember[]): string[] =>
  members.map((member) => `${member.user.id.toLowerCase()}:${member.role}`).sort();

/**
 * The members the target should list: the mapper's merged members (`mapProject`: one per user,
 * an admin row winning), only those with a profile (the target lists no others).
 */
export const mappedMemberKeys = (
  members: readonly MemberRec[],
  profiles: ReadonlySet<string>,
): string[] =>
  members
    .filter((member) => profiles.has(member.userId))
    .map((member) => `${member.userId}:${member.role}`)
    .sort();

/** Two name lists as sets. */
export const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
  sameJson([...new Set(a)].sort(), [...new Set(b)].sort());
