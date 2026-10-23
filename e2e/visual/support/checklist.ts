import {
  FEEDBACK_DEFINITION,
  FEEDBACK_RESPONSES,
  HISTORY_SAVES,
  PROJECT_NAME,
} from "../data-set.js";

const STEPS = [
  "Use a **dedicated surveyjs.io account**: not a site administrator, no licence, an empty cart, no other surveys or projects. (A fresh registration is easiest.) Its name and email never reach the screenshots.",
  `Settings -> Manage MySurveys: create the project \`${PROJECT_NAME}\`.`,
  `My Surveys -> switch to \`${PROJECT_NAME}\` -> Create a Survey -> rename it \`Team retro\`.`,
  'Switch to Personal Surveys. Create a survey, rename it `Old poll`, then "..." -> Archive.',
  "Create `Product poll`, then `Event registration` (rename each new survey).",
  'Create a survey, rename it `Customer feedback`, open it, paste the printed JSON in the JSON Editor tab, wait for the save, close the editor. "..." -> Publish once, reload, and check the menu now shows Unpublish.',
  '"..." -> Run, and submit the three printed responses, one per page load.',
  '"..." -> View Results -> Details -> turn **Grant Access** on.',
  `Open \`Customer feedback\` in the editor, change its title and wait for the save, then restore it and wait again (${HISTORY_SAVES} saves for the history screen; this also puts it first in the list). "..." -> View History must list at least ${HISTORY_SAVES} entries.`,
  "Do not open the editor tour or change anything else. Then run `pnpm visual:capture`.",
];

/** The product owner's checklist for the live account, then the definition JSON and the responses. */
export function checklistText(): string {
  const lines = ["Prepare the surveyjs.io account:", ""];
  STEPS.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push("", "Definition of `Customer feedback` (JSON Editor tab):", "");
  lines.push(JSON.stringify(FEEDBACK_DEFINITION, null, 2));
  lines.push("", "The three responses (submit each one on its own page load):");
  FEEDBACK_RESPONSES.forEach((response, index) => {
    lines.push("", `Response ${index + 1}:`, JSON.stringify(response, null, 2));
  });
  return `${lines.join("\n")}\n`;
}
