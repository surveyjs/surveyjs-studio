import { hiddenAnswerColumns } from "../../domain/layout-columns.js";
import type { SurveyRecord } from "../../domain/types.js";
import {
  definitionFromLegacy,
  isGuid,
  privateQuestionsFromLegacy,
  surveyFromLegacy,
  themeFromLegacy,
  UnmappableLegacyRowError,
} from "../../providers/azure-legacy/mapping.js";
import type { LegacySurveyRow } from "../../providers/azure-legacy/rows.js";
import type { SurveyRec } from "../records.js";
import type { Report } from "./report.js";
import { withoutBom, withoutNul } from "./text.js";

/**
 * A survey row with its definition, permissions and column layout texts (null: no such blob).
 * `ctx` holds lower-case ids: the projects copied, the projects skipped for having no members,
 * and the people who get a profile. The decisions (design, Decisions):
 * - a survey of a missing or member-less project goes to its creator's personal surveys (archived
 *   flag kept) when the creator has a profile; otherwise it stays as it is, naming the project;
 * - `private_questions` is the union of the permissions' non-public names and the layout's hidden
 *   or non-public answer columns; either setting unreadable turns public results off.
 */
export function mapSurvey(
  row: LegacySurveyRow & { theme: string | null },
  definitionText: string | null,
  permissionsText: string | null,
  columnsText: string | null,
  ctx: {
    projects: ReadonlySet<string>;
    projectsWithoutMembers: ReadonlySet<string>;
    people: ReadonlySet<string>;
    report: Report;
  },
): SurveyRec | null {
  const { report } = ctx;
  const surveyId = row.id.toLowerCase();
  for (const value of [row.id, row.userid, row.postid, row.resultid]) {
    if (value !== null && !isGuid(value)) {
      report.skip("survey", { surveyId }, "an id is not a GUID");
      return null;
    }
  }
  const ownerId = row.userid?.toLowerCase() ?? "";
  let record: SurveyRecord;
  try {
    record = surveyFromLegacy(row, ctx.projects.has(ownerId) ? "project" : "personal");
  } catch (error) {
    if (!(error instanceof UnmappableLegacyRowError)) throw error;
    report.skip("survey", { ...error.ids }, error.message);
    return null;
  }
  const ids = { surveyId };

  // Ownership: a survey of a user stays with them; of a copied project stays there; anything
  // else names a project that is missing or has no members.
  let owner = record.owner;
  let creatorId = record.creatorId;
  if (creatorId !== null && !isGuid(creatorId)) creatorId = null;
  if (!ctx.projects.has(ownerId) && !ctx.people.has(ownerId)) {
    const memberless = ctx.projectsWithoutMembers.has(ownerId);
    if (creatorId !== null && ctx.people.has(creatorId)) {
      owner = { kind: "personal", userId: creatorId };
      report.note(memberless ? "survey_moved_from_memberless_project" : "survey_moved_to_creator", {
        ...ids,
        ownerId,
      });
    } else {
      owner = { kind: "project", projectId: ownerId };
      report.note("survey_kept_in_missing_project", { ...ids, ownerId });
    }
  }

  // Public results: the union of both hiding rules; an unreadable one turns them off.
  const privateQuestions = new Set<string>();
  let publicResults = record.settings.publicResults;
  if (permissionsText !== null) {
    const names = privateQuestionsFromLegacy(permissionsText);
    if (names === null) {
      publicResults = false;
      report.note("public_results_off_unreadable_setting", { ...ids, setting: "permissions" });
    } else for (const name of names) privateQuestions.add(name);
  }
  if (columnsText !== null) {
    const names = hiddenAnswerColumns(columnsText);
    if (names === null) {
      publicResults = false;
      report.note("public_results_off_unreadable_setting", { ...ids, setting: "columns" });
    } else for (const name of names) privateQuestions.add(name);
  }

  let definition: Record<string, unknown> = {};
  if (definitionText !== null) {
    try {
      definition = definitionFromLegacy(surveyId, withoutBom(definitionText));
    } catch (error) {
      if (!(error instanceof UnmappableLegacyRowError)) throw error;
      report.note("definition_unreadable", ids);
    }
  }
  const theme = themeFromLegacy(surveyId, row.theme === null ? null : withoutBom(row.theme), {
    warn: () => report.note("theme_unreadable", ids),
  });

  return {
    record: {
      ...record,
      owner,
      creatorId,
      settings: { ...record.settings, publicResults },
    },
    definition: withoutNul(definition, ids, report),
    theme: withoutNul(theme, ids, report),
    privateQuestions: [...privateQuestions],
  };
}
