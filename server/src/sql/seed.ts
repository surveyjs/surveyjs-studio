import type { ByteStore } from "../bytes/types.js";
import { legacyFileRecord } from "../domain/legacy-file.js";
import type { LayoutKind } from "../domain/types.js";
import type { MemorySeed } from "../providers/memory.js";
import { seedInstanceAdmin } from "../providers/seed-instance-admin.js";
import type { SqlDatabase } from "./database.js";
import { insertResponses } from "./result-store.js";
import { deleteSurveyRows, insertSurvey } from "./survey-store.js";
import { isoOf, jsonText } from "./values.js";

/** When the seed's accounts were made. */
const SEEDED_AT = "2025-01-01T00:00:00.000Z";

export interface SeedReport {
  readonly surveys: number;
  readonly projects: number;
}

/**
 * Loads the shared seed into the SQL stores (surveys with their definitions, themes, history,
 * responses, markers and layouts; projects with their members), in one transaction. A seed
 * survey or project that exists is replaced with what belongs to it; every other row stays, so
 * running it again resets the seed data and keeps what people made.
 *
 * With `bytes` (the file store) the seed's legacy files are loaded too: each is a `files` row of
 * `legacyFileRecord` (the all-zero survey) named in `legacy_files`, its bytes written before the
 * transaction (a key the record fixes, so a second run replaces them).
 */
export async function seedSqlStores(
  database: SqlDatabase,
  seed: MemorySeed,
  options: { readonly bytes?: ByteStore } = {},
): Promise<SeedReport> {
  const byId = <T>(map: Record<string, T> | undefined, id: string): T | undefined =>
    Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === id)?.[1];
  const legacyFiles = options.bytes
    ? (seed.legacyFiles ?? []).map((f) => ({
        ...f,
        record: legacyFileRecord(f.kind, f.name, f.content.length),
      }))
    : [];
  for (const { record, content } of legacyFiles) {
    await options.bytes!.put(`${record.surveyId}/${record.id}`, content, record.contentType);
  }
  await database.db.transaction().execute(async (trx) => {
    // The seed users as local accounts without a password (USER_DIRECTORY=local reads them; the
    // memory directory has its own copy), and the seed's instance admin. A blocked user is a
    // disabled account. An account with a seed user's id or email is replaced.
    const seeded = [
      ...seed.users.map((user) => ({ user, instanceRole: "user" as const })),
      { user: seedInstanceAdmin, instanceRole: "admin" as const },
    ];
    for (const { user, instanceRole } of seeded) {
      const id = user.id.toLowerCase();
      const email = user.email.toLowerCase();
      await trx
        .deleteFrom("users")
        .where((eb) => eb.or([eb("id", "=", id), eb("email", "=", email)]))
        .execute();
      await trx
        .insertInto("users")
        .values({
          id,
          email,
          display_name: user.displayName,
          instance_role: instanceRole,
          status: user.blocked ? "disabled" : "active",
          password_hash: null,
          must_change_password: false,
          site_blocked: false,
          licence_expires_at: null,
          session_epoch: 0,
          created_at: SEEDED_AT,
          last_sign_in_at: null,
        })
        .execute();
    }
    for (const survey of seed.surveys) {
      const id = survey.id.toLowerCase();
      await deleteSurveyRows(trx, id);
      const definition = byId(seed.definitions, id);
      const theme = byId(seed.themes, id);
      await insertSurvey(trx, database.dialect, survey, {
        ...(definition !== undefined && { definition }),
        ...(theme !== undefined && { theme }),
        history: byId(seed.history, id) ?? [],
      });
      // The survey's responses and markers went with it (cascade).
      await insertResponses(trx, database.dialect, id, byId(seed.responses, id) ?? []);
      const markers = Object.entries(byId(seed.completions, id) ?? {});
      if (markers.length > 0) {
        await trx
          .insertInto("completion_markers")
          .values(
            markers.map(([clientId, { partial }]) => ({
              survey_id: id,
              client_id: clientId,
              partial,
            })),
          )
          .execute();
      }
      const layouts = Object.entries(byId(seed.layouts, id) ?? {});
      if (layouts.length > 0) {
        await trx
          .insertInto("survey_layouts")
          .values(
            layouts.map(([kind, text]) => ({ survey_id: id, kind: kind as LayoutKind, text })),
          )
          .execute();
      }
      const privateQuestions = byId(seed.privateResultQuestions, id);
      if (privateQuestions !== undefined) {
        await trx
          .insertInto("private_questions")
          .values({ survey_id: id, names: jsonText(database.dialect, privateQuestions) })
          .execute();
      }
    }
    // A seed project is replaced with its memberships (cascade); its surveys stay where they are.
    for (const project of seed.projects) {
      const id = project.id.toLowerCase();
      const createdAt = isoOf(project.createdAt);
      await trx.deleteFrom("projects").where("id", "=", id).execute();
      await trx
        .insertInto("projects")
        .values({
          id,
          name: project.name,
          creator_id: project.creatorId?.toLowerCase() ?? null,
          created_at: createdAt,
        })
        .execute();
      const members = seed.memberships.filter((m) => m.projectId.toLowerCase() === id);
      if (members.length > 0) {
        await trx
          .insertInto("project_members")
          .values(
            members.map((m) => ({
              project_id: id,
              user_id: m.userId.toLowerCase(),
              role: m.role,
              created_at: createdAt,
              updated_at: createdAt,
            })),
          )
          .execute();
      }
    }
    // A seed legacy file replaces its own files row and takes its name over (a file the name named
    // before stays, without the name).
    for (const { record } of legacyFiles) {
      await trx
        .deleteFrom("legacy_files")
        .where("kind", "=", record.kind)
        .where("legacy_name", "=", record.name)
        .execute();
      await trx.deleteFrom("files").where("id", "=", record.id).execute();
      await trx
        .insertInto("files")
        .values({
          id: record.id,
          survey_id: record.surveyId,
          owner_user_id: null,
          kind: record.kind,
          name: record.name,
          content_type: record.contentType,
          size: record.size,
          created_at: record.createdAt,
        })
        .execute();
      await trx
        .insertInto("legacy_files")
        .values({ kind: record.kind, legacy_name: record.name, file_id: record.id })
        .execute();
    }
    // The seed's invitations; those of a seed project were dropped with it (cascade).
    for (const invitation of seed.invitations ?? []) {
      const projectId = invitation.projectId.toLowerCase();
      const email = invitation.email.toLowerCase();
      await trx
        .deleteFrom("project_invitations")
        .where("project_id", "=", projectId)
        .where("email", "=", email)
        .execute();
      await trx
        .insertInto("project_invitations")
        .values({
          project_id: projectId,
          email,
          role: invitation.role,
          invited_by: invitation.invitedBy.toLowerCase(),
          created_at: isoOf(invitation.createdAt),
        })
        .execute();
    }
  });
  return { surveys: seed.surveys.length, projects: seed.projects.length };
}
