// The old API's survey record (ADR 0040 point 1: property names, order and value formats exact),
// built from Studio's `Survey`, and the HTML encoding the old `getSurveyInfo` gave its `Json`.
import type { components } from "@surveyjs-studio/contract/types";
import { EMPTY_GUID } from "./binding.js";
import { oldTime } from "./dotnet-format.js";

export type Survey = components["schemas"]["Survey"];

/**
 * The old survey record, its 16 fields in the old order. `dates`: `list` for the list answers
 * (`getActive`, `getArchive`), whose times end in `Z`, and `single` for the single reads
 * (`getSurveyInfo`, `create`), whose times do not.
 *
 * `UserId` is the owner: the project for a project survey; for a Personal survey
 * `personalOwnerId`, which is the caller, since only its owner can see a Personal survey (ADR
 * 0009). `Theme` is the theme as JSON text (`null` without one or for an empty one), `Json` always
 * `null`. `IsPublished` is never `null` and `CreatorId` is the real creator (all zeros when
 * unknown), as `docs/api/legacy-compat.md` lists.
 */
export function legacySurvey(
  survey: Survey,
  dates: "list" | "single",
  personalOwnerId: string,
): Record<string, unknown> {
  const utc = dates === "list";
  const theme = survey.theme;
  return {
    Name: survey.name,
    IsArchived: survey.archived,
    UserId: (survey.projectId ?? personalOwnerId).toLowerCase(),
    CreatorId: (survey.creatorId ?? EMPTY_GUID).toLowerCase(),
    PostId: survey.postId.toLowerCase(),
    ResultId: survey.resultId.toLowerCase(),
    PublishId: survey.legacyPublishId?.toLowerCase() ?? null,
    IsPublished: survey.published,
    UseCookies: survey.useCookies,
    UpdatedOn: oldTime(survey.updatedAt, utc),
    CreatedAt: oldTime(survey.createdAt, utc),
    AllowAccessResult: survey.settings.publicResults === true,
    StoreIPAddress: survey.settings.storeRespondentIp === true,
    Theme:
      theme === undefined || theme === null || Object.keys(theme).length === 0
        ? null
        : JSON.stringify(theme),
    Json: null,
    Id: survey.id.toLowerCase(),
  };
}

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * The text as the old API HTML-encoded a survey's JSON for `getSurveyInfo`: the five HTML
 * characters as entities, U+00A0 to U+00FF and characters beyond the Basic Multilingual Plane as
 * numeric entities, a lone surrogate as U+FFFD, everything else as it is.
 */
export function netHtmlEncode(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const code = char.charCodeAt(0);
    const entity = HTML_ENTITIES[char];
    if (entity !== undefined) out += entity;
    else if (code >= 0xa0 && code <= 0xff) out += `&#${code};`;
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = text.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += `&#${text.codePointAt(index)!};`;
        index += 1;
      } else {
        out += String.fromCharCode(0xfffd);
      }
    } else out += char;
  }
  return out;
}
