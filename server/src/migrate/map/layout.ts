import type { SurveyDefinition } from "../../domain/types.js";
import { commentSuffixOf, questionsOf } from "../../results/definition.js";

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
