import type { SurveyRecord } from "../../domain/types.js";
import {
  definitionFromLegacy,
  isGuid,
  privateAnswersFromLegacy,
  surveyFromLegacy,
  themeFromLegacy,
  UnmappableLegacyRowError,
} from "../../providers/azure-legacy/mapping.js";
import type { LegacySurveyRow } from "../../providers/azure-legacy/rows.js";
import { answerNamesOf } from "../../results/definition.js";
import type { SurveyRec } from "../records.js";
import type { Report } from "./report.js";
import { withoutBom, withoutNul } from "./text.js";

/**
 * A survey row with its definition, permissions and column layout texts (null: no such blob).
 * `ctx` holds lower-case ids: the projects copied, the projects skipped for having no members,
 * and the people who get a profile. The decisions (design, Decisions):
 * - a survey of a missing or member-less project goes to its creator's personal surveys (archived
 *   flag kept) when the creator has a profile; otherwise it stays as it is, naming the project;
 * - `private_questions` follows the old public results' rule (`privateAnswers`): the permissions'
 *   private entries without a layout listing columns; the layout's hidden or non-public answer
 *   columns without permissions; with both, everything but the names the permissions mark public
 *   and the layout lists. Either setting unreadable turns public results off. Public results on
 *   with both settings and no public answer is reported (`public_results_no_public_answer`).
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
    /** Every legacy user id: an owner in it is a person, with a profile or not. */
    legacyUsers: ReadonlySet<string>;
    /** Answer names beyond the definition's (the keys of the survey's responses). */
    extraAnswerNames?: Iterable<string>;
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
  if (!ctx.projects.has(ownerId) && !ctx.legacyUsers.has(ownerId)) {
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

  let definition: Record<string, unknown> = {};
  if (definitionText !== null) {
    try {
      definition = definitionFromLegacy(surveyId, withoutBom(definitionText));
    } catch (error) {
      if (!(error instanceof UnmappableLegacyRowError)) throw error;
      report.note("definition_unreadable", ids);
    }
  }
  // Public results: the old rule on both settings; an unreadable one turns them off.
  let publicResults = record.settings.publicResults;
  const answerNames = [...answerNamesOf(definition), ...(ctx.extraAnswerNames ?? [])];
  const privacy = privateAnswersFromLegacy(permissionsText, columnsText, answerNames);
  for (const setting of privacy.unreadable) {
    publicResults = false;
    report.note("public_results_off_unreadable_setting", { ...ids, setting });
  }
  // Both settings and no answer left public (the submit time and id are no answers): the owner
  // sees empty public results, as the old public results answered.
  if (
    publicResults &&
    privacy.listedUnderPermissions !== null &&
    privacy.publicNames.every((name) => name === "HappendAt" || name === "InstanceId")
  ) {
    report.note("public_results_no_public_answer", ids);
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
    privateQuestions: privacy.privateNames,
  };
}
