import type { SurveyPatch } from "../api/surveys";

export type DetailsSetting = "publicResults" | "storeRespondentIp";

const TOGGLES = {
  publicResults: {
    off: {
      text: "Toggle if you want to enable access to the survey results with a direct link.",
      button: "Grant Access",
    },
    on: {
      text: "Your Survey results can be accessible via direct Url.",
      button: "Disable Access",
    },
  },
  storeRespondentIp: {
    off: {
      text: "Toggle to store the IP addresses of your respondents along with other answers",
      button: "Save Respondent IP in Results",
    },
    on: {
      text: "The IP addresses of your respondents are stored along with other answers. Toggle not to store.",
      button: "Do not save Respondent IP in Results",
    },
  },
} as const;

/** The texts for a setting that is `on` (or not) and the merge patch that flips it. */
export function settingToggle(
  setting: DetailsSetting,
  on: boolean,
): { text: string; button: string; patch: SurveyPatch } {
  const { text, button } = TOGGLES[setting][on ? "on" : "off"];
  return { text, button, patch: { settings: { [setting]: !on } } };
}

/** "Clear All Data" is enabled only when the typed text is exactly the survey name. */
export function deleteConfirmed(typed: string, surveyName: string): boolean {
  return typed === surveyName;
}

/** A response time in the viewer locale. */
export function responseTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
