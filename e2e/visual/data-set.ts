// The visual data set: the account content both sides of the visual comparison show.
// The product owner creates it once by hand in a dedicated surveyjs.io account (support/checklist.ts);
// the visual run creates it through the HTTP API for Erin in a fresh memory server.

/** The visual user: Erin Erasable (`erasable@example.com`); she has no fixture data. */
export const VISUAL_USER = "erasable";

export const PROJECT_NAME = "Visual project";

/** The surveys of one list scope, in display order (newest change first). */
export interface VisualScope {
  readonly label: string;
  readonly names: readonly string[];
}

/** The survey names of each scope, in the order the list shows them. */
export const PERSONAL_ACTIVE = ["Customer feedback", "Event registration", "Product poll"] as const;
export const PERSONAL_ARCHIVED = ["Old poll"] as const;
export const PROJECT_SURVEYS = ["Team retro"] as const;

/** The survey that is published, has responses and public results ("Grant Access"). */
export const FEEDBACK_NAME = "Customer feedback";

export const FEEDBACK_DEFINITION = {
  title: "Customer feedback",
  pages: [
    {
      name: "page1",
      elements: [
        {
          type: "radiogroup",
          name: "satisfaction",
          title: "How satisfied are you with our service?",
          choices: ["Very satisfied", "Satisfied", "Neutral", "Unsatisfied"],
        },
        {
          type: "rating",
          name: "recommend",
          title: "How likely are you to recommend us to a friend?",
          rateMin: 0,
          rateMax: 10,
        },
      ],
    },
  ],
};

export const FEEDBACK_RESPONSES = [
  { satisfaction: "Satisfied", recommend: 9 },
  { satisfaction: "Very satisfied", recommend: 10 },
  { satisfaction: "Neutral", recommend: 6 },
];

/**
 * What the capture writes to `e2e/visual/baselines/states.json`: the live history count (the app
 * setup makes its history the same length) and the library versions the live pages report.
 */
export interface VisualStates {
  capturedAt?: string;
  playwright?: string;
  historyEntries: number;
  /**
   * Whether the live `Customer feedback` lists as published. It may list as unpublished after
   * Publish; the capture records it.
   */
  feedbackPublished?: boolean;
  liveVersions: Record<string, string | null>;
}

/**
 * The editor saves of `Customer feedback` the product owner makes on surveyjs.io before a capture
 * (change its title, then restore it). surveyjs.io lists history since its fix of 2026-10-20
 * (3389d6cd49); earlier saves are not listed. The capture records the live count in `states.json`
 * and the app side makes the same number of entries.
 */
export const HISTORY_SAVES = 2;

export const DEFAULT_STATES: VisualStates = { historyEntries: HISTORY_SAVES, liveVersions: {} };
