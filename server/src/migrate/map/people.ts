import { hashCredential, lastFour } from "../../credentials/format.js";
import { isGuid } from "../../providers/azure-legacy/mapping.js";
import type { LegacyUserRow } from "../../providers/azure-legacy/rows.js";
import type { KeyRec, PersonRec } from "../records.js";
import type { Report } from "./report.js";

/**
 * The profiles to pre-create (ADR 0043 point 6) for the people the copied data names (`named`,
 * lower-case ids), and their legacy access keys. No email, an `@invalid` email, or an email equal
 * to another named person's after lower-casing: no rows, listed in the report by id (the data keeps
 * the id). Never an admin; nobody gets a password.
 */
export function mapPeople(
  rows: readonly (LegacyUserRow & { accesskey: string | null })[],
  named: ReadonlySet<string>,
  runStart: string,
  report: Report,
): { people: PersonRec[]; keys: KeyRec[] } {
  const candidates: { id: string; email: string; row: (typeof rows)[number] }[] = [];
  for (const row of rows) {
    const id = row.id.toLowerCase();
    if (!named.has(id)) continue;
    if (!isGuid(row.id)) {
      report.skip("person", { userId: id }, "the id is not a GUID");
      continue;
    }
    const email = (row.email ?? "").trim().toLowerCase();
    if (email === "" || email.endsWith("@invalid")) {
      report.note("person_without_email", { userId: id });
      continue;
    }
    candidates.push({ id, email, row });
  }

  const byEmail = new Map<string, number>();
  for (const { email } of candidates) byEmail.set(email, (byEmail.get(email) ?? 0) + 1);

  const people: PersonRec[] = [];
  const keys: KeyRec[] = [];
  for (const { id, email, row } of candidates) {
    if ((byEmail.get(email) ?? 0) > 1) {
      report.note("person_email_conflict", { userId: id });
      continue;
    }
    people.push({
      id,
      email,
      displayName: row.displayname?.trim() ? row.displayname : email,
      siteBlocked: row.blocked === 1,
      createdAt: runStart,
    });
    const key = row.accesskey;
    if (key !== null && key.trim() !== "") {
      keys.push({
        userId: id,
        keyHash: hashCredential(key, "legacy-key"),
        lastFour: lastFour(key.toLowerCase()),
        createdAt: runStart,
      });
    }
  }
  return { people, keys };
}
