import { privateNamesOfLayout } from "@surveyjs-studio/column-layout";
import type { SurveyDefinition } from "../../domain/types.js";
import { commentSuffixOf, questionsOf } from "../../results/definition.js";
import { withoutBom } from "./text.js";

/**
 * The answer names a definition can produce in a response: each question's data key (its
 * `valueName`, else its name) and, for a question with a comment area, the key with the comment
 * suffix. The copy adds the keys of the responses it reads.
 */
export function answerNamesOf(definition: SurveyDefinition): string[] {
  const suffix = commentSuffixOf(definition);
  return questionsOf(definition).flatMap(({ key, hasComment }) =>
    hasComment ? [key, key + suffix] : [key],
  );
}

/**
 * The names the survey's saved column layout keeps out of public results, among `answerNames`
 * (see `privateNamesOfLayout`). No layout (null, empty text, or no columns listed) hides nothing;
 * null when the text cannot be read as the old calculation read it. One BOM is removed.
 */
export function layoutPrivateNames(
  layoutText: string | null,
  answerNames: Iterable<string>,
): string[] | null {
  if (layoutText === null || layoutText.trim() === "") return [];
  let layout: unknown;
  try {
    layout = JSON.parse(withoutBom(layoutText));
  } catch {
    return null;
  }
  return privateNamesOfLayout(layout, answerNames);
}
