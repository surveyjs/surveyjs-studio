// The screen manifest: every screen of the visual comparison, with its live URL, its app URL, the
// steps that reach the state, the element to shoot and the per-side adjustments (Step 13).
// Types only from Playwright; this file is pure data.

export type Side = "live" | "app";
export type Kind = "page" | "element" | "library"; // threshold class
export type Category = "departure" | "library" | "live-data" | "rendering"; // acceptance rule
export type Step = { readonly click: string } | { readonly hover: string }; // read only, by type

export interface Adjustment {
  readonly selector: string;
  readonly reason: string; // non-empty
  readonly category: Category;
  readonly optional?: boolean; // may match nothing (default: must match at least one element)
}

export interface SideSpec {
  readonly path: string; // starts with "/"; placeholders {feedbackId} {feedbackResultId} {projectId}
  readonly steps?: readonly Step[];
  readonly ready: string; // visible before steps and before the shot
  readonly idle?: string; // must be hidden or gone after the steps and before the shot (a loading overlay)
  readonly target?: string; // element shot; absent = the 1440x900 viewport
  readonly hide?: readonly Adjustment[]; // display: none !important
  readonly mask?: readonly Adjustment[]; // Playwright mask (pink box)
}

export interface Normalization {
  readonly live: string;
  readonly app: string;
  readonly text: string;
  readonly reason: string;
  readonly category: Category;
  readonly optional?: boolean; // may match nothing on a side (default: must match at least one element)
}

/**
 * A difference left in the image: nothing hides, masks or normalizes it, and it fits within the
 * screen's `maxDiffPixelRatio`. It is recorded so every accepted difference has an entry.
 */
export interface Residual {
  readonly what: string;
  readonly reason: string; // non-empty
  readonly category: Category;
}

export interface Screen {
  readonly id: string; // kebab-case; the PNG name
  readonly group: "list" | "pages" | "results"; // fix-task split; describe block name
  readonly kind: Kind;
  readonly cookieBanner?: boolean; // true: the consent flag is not preset
  readonly live: SideSpec;
  readonly app: SideSpec;
  readonly normalize?: readonly Normalization[];
  readonly residual?: readonly Residual[];
  readonly maxDiffPixelRatio: number;
  readonly thresholdReason?: string; // required when above the kind's default
  readonly skip?: string; // non-empty reason: the screen is neither captured nor compared
}

export const LIVE_ORIGIN = "https://surveyjs.io";

/** `maxDiffPixelRatio` per kind: the default, and the cap no acceptance may pass. */
export const KIND_LIMITS: Record<Kind, { readonly default: number; readonly cap: number }> = {
  page: { default: 0.005, cap: 0.01 },
  element: { default: 0.01, cap: 0.02 },
  library: { default: 0.02, cap: 0.05 },
};

/** On every screen that shows the site header. */
export const HEADER_NORMALIZATIONS: readonly Normalization[] = [
  {
    live: ".v2-class---top-menu-item--drop-down-account .v2-class---top-menu-item__text",
    app: ".v2-class---top-menu-item--drop-down-account .v2-class---top-menu-item__text",
    text: "Account",
    reason:
      "Step 3 shows the user's name where live shows the constant Account (open: ADR 0020 › To confirm)",
    category: "departure",
  },
  {
    live: 'a[href="https://github.com/surveyjs/survey-library"] .v2-class---top-menu-item__text',
    app: 'a[href="https://github.com/surveyjs/survey-library"] .v2-class---top-menu-item__text',
    text: "4.7k",
    reason: "the star count changes daily",
    category: "live-data",
  },
];

const LIST_ITEM = ".v2-class---my-surveys-page__list-item";
const SURVEY_DATE = ".v2-class---my-surveys-page__survey-date-item-text";
// The row menus open on Product poll, unpublished on both sides: on live, Customer feedback may list
// as unpublished (the capture records its flag in states.json), so its menu items could differ.
const MENU_ROW = `${LIST_ITEM}:has-text("Product poll")`;
const SELECTOR_TRIGGER_APP = ".v2-class---drop-down-button__selected-item-button";
const SURVEY_IDS = '.v2-class---drop-down-menu-item__text:text-is("Survey IDs")';
const DETAILS_DATES =
  ".survey-results-header-left .survey-results-header-line:nth-child(n+2):nth-child(-n+3) > span:nth-child(2)";
const DASHBOARD_LICENCE = ".sa-commercial";
const PROJECTS_SECTION = "section.v2-class---account-page__projects-section";
const PROJECT_SUMMARY = ".v2-class---account-page__project summary";
const CHARTS_READY = "[data-question]";
const TABLE_READY = ".tabulator-row";
const DETAILS_READY = '.survey-results-header-line:has-text("Last response at")';

/** The embed tab's code shows the survey ids (live: embed-tab.tsx:376; app: EmbedTab.tsx). */
const EMBED_CODE_MASK: Adjustment = {
  selector: ".svc-embed-tab__code-container",
  reason: "the code shows the survey ids",
  category: "live-data",
};

/** At 1440 px the Embed Survey tab sits in the Creator tab strip's "More" popup (live finding). */
const EMBED_POPUP_ITEM = '.svc-tabbed-menu-item__popup li:has-text("Embed Survey")';
const EMBED_STEPS_LIVE: readonly Step[] = [
  { click: ".svc-tabbed-menu-dots__item" },
  { click: EMBED_POPUP_ITEM },
];
const EMBED_STEPS_APP: readonly Step[] = [
  { click: ".svc-tabbed-menu-dots" },
  { click: EMBED_POPUP_ITEM },
];

/** The survey dates of the list cannot match: they are fixed to one text on both sides. */
const SURVEY_DATES: Normalization = {
  live: SURVEY_DATE,
  app: SURVEY_DATE,
  text: "1/1/2026",
  reason: "the survey dates are the days the data was created",
  category: "live-data",
};

const LIST_NORMALIZATIONS: readonly Normalization[] = [...HEADER_NORMALIZATIONS, SURVEY_DATES];

const LIST_ACTIVE_LIVE = "/Service/MySurveys/personal?type=list";
const LIST_ACTIVE_APP = "/?project=personal";

const listSide = (
  path: string,
  extra: Pick<SideSpec, "steps" | "target"> = {},
  ready: string = LIST_ITEM,
): SideSpec => ({ path, ready, ...extra });

const ROW_MENU_LIVE: readonly Step[] = [
  { hover: MENU_ROW },
  { click: `${MENU_ROW} .v2-class---my-surveys-page__survey-context-menu-button` },
];
const ROW_MENU_APP: readonly Step[] = [
  { hover: MENU_ROW },
  { click: `${MENU_ROW} [role="button"][aria-label="Survey actions"]` },
];

const EDITOR_READY = ".svc-creator .svc-question__content";
// The Embed Survey tab replaces the designer, so its ready selector must outlive the tab switch.
const EMBED_READY = ".svc-creator .svc-tabbed-menu";
const EDITOR_HIDE_APP: readonly Adjustment[] = [
  {
    selector: ".svc-creator__banner",
    reason:
      "survey-creator-core 3.2.2 shows its licence banner without a licence key; the live site has a key",
    category: "library",
    optional: true,
  },
  {
    selector: '#edit-survey-change-name-container [role="status"]',
    reason: "ADR 0012 R18: the save status is ours; the live bottom bar has none",
    category: "departure",
    optional: true,
  },
];

// The legacy results page shows this overlay (the site's page markup) while it loads; its content is
// already in the DOM beneath it. The app has no confirmed equivalent, so the app side sets no idle.
const RESULTS_IDLE_LIVE = "#loadingIndicator";

const RESULTS_HIDE_LIVE: readonly Adjustment[] = [
  {
    selector: ".survey-results-page__warning",
    reason: "ADR 0015 R12: no 1,000 banner",
    category: "departure",
  },
];
// Legacy adds the submission time as a hidden question named HappendAt, so the live Dashboard draws
// a "Submitted" card (the Dashboard's question element carries the name in data-question).
const SUBMITTED_CARD_HIDE_LIVE: Adjustment = {
  selector: '.sa-question[data-question="HappendAt"]',
  reason:
    "ADR 0015 R13: Submitted is a table-only column, so the app's Summary has no Submitted card",
  category: "departure",
};
// The app's own way back to the list (results.module.css .back); surveyjs.io has none.
const BACK_LINK_HIDE_APP: Adjustment = {
  selector: ".survey-results-page > p.v2-class---paragraph:has(> a.v2-class---paragraph-link)",
  reason: "app navigation link, no live counterpart (Step 9)",
  category: "departure",
};
// The live public results page is the results partial inside the site layout. The app's public page
// has no site shell (ADR 0016 R19), so the live header (both top bars) and footer are hidden.
const PUBLIC_SHELL_HIDE_LIVE: readonly Adjustment[] = [
  {
    selector: "header.v2-class---top-bar",
    reason: "ADR 0016 R19: the public results page has no site shell",
    category: "departure",
  },
  {
    selector: "footer.v2-class---footer",
    reason: "ADR 0016 R19: the public results page has no site shell",
    category: "departure",
  },
  {
    selector: '.tabs__tab-wrapper:has(> a[href="#info"])',
    reason: "ADR 0016 R19: the public results page has no Details tab",
    category: "departure",
  },
];
const DASHBOARD_BANNER_HIDE_APP: readonly Adjustment[] = [
  {
    selector: DASHBOARD_LICENCE,
    reason:
      "the Dashboard library shows its licence banner without a licence key; the live site has a key",
    category: "library",
    optional: true,
  },
];

const resultsSide = (
  livePath: string,
  appPath: string,
  ready: { live: string; app: string },
  liveHide: readonly Adjustment[] = [],
): Pick<Screen, "live" | "app"> => ({
  live: {
    path: livePath,
    ready: ready.live,
    idle: RESULTS_IDLE_LIVE,
    hide: [...RESULTS_HIDE_LIVE, ...liveHide],
  },
  app: {
    path: appPath,
    ready: ready.app,
    hide: [...DASHBOARD_BANNER_HIDE_APP, BACK_LINK_HIDE_APP],
  },
});

/** The table's Submitted cells (legacy and app both use the data name HappendAt). */
const SUBMITTED_CELLS = '.tabulator-row .tabulator-cell[tabulator-field="HappendAt"]';

export const SCREENS: readonly Screen[] = [
  {
    id: "list-active",
    group: "list",
    kind: "page",
    live: listSide(LIST_ACTIVE_LIVE),
    app: listSide(LIST_ACTIVE_APP),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "list-archived",
    group: "list",
    kind: "page",
    live: listSide("/Service/MySurveys/personal?type=archived"),
    app: listSide("/?project=personal&archived=true"),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "list-project",
    group: "list",
    kind: "page",
    live: listSide("/Service/MySurveys/{projectId}?type=list"),
    app: listSide("/?project={projectId}"),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "list-project-selector",
    group: "list",
    kind: "page",
    live: listSide(LIST_ACTIVE_LIVE, {
      steps: [{ click: ".v2-class---drop-down-button__selected-item" }],
    }),
    app: listSide(LIST_ACTIVE_APP, { steps: [{ click: SELECTOR_TRIGGER_APP }] }),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "list-row-menu",
    group: "list",
    kind: "page",
    live: listSide(LIST_ACTIVE_LIVE, { steps: ROW_MENU_LIVE }),
    app: listSide(LIST_ACTIVE_APP, { steps: ROW_MENU_APP }),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "list-row-menu-ids",
    group: "list",
    kind: "page",
    live: listSide(LIST_ACTIVE_LIVE, { steps: [...ROW_MENU_LIVE, { hover: SURVEY_IDS }] }),
    app: listSide(LIST_ACTIVE_APP, { steps: [...ROW_MENU_APP, { hover: SURVEY_IDS }] }),
    normalize: LIST_NORMALIZATIONS,
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "shell-cookie-banner",
    group: "list",
    kind: "element",
    cookieBanner: true,
    live: listSide(LIST_ACTIVE_LIVE, { target: ".v2-class---banner--cookies" }),
    app: listSide(LIST_ACTIVE_APP, { target: ".v2-class---banner--cookies" }),
    maxDiffPixelRatio: 0.01,
  },
  {
    id: "shell-footer",
    group: "list",
    kind: "element",
    live: listSide(LIST_ACTIVE_LIVE, { target: "footer.v2-class---footer" }),
    app: listSide(LIST_ACTIVE_APP, { target: "footer.v2-class---footer" }),
    maxDiffPixelRatio: 0.01,
  },
  {
    id: "editor-designer",
    group: "pages",
    kind: "library",
    live: { path: "/Service/EditSurvey/{feedbackId}", ready: EDITOR_READY },
    app: { path: "/surveys/{feedbackId}/edit", ready: EDITOR_READY, hide: EDITOR_HIDE_APP },
    normalize: HEADER_NORMALIZATIONS,
    maxDiffPixelRatio: 0.02,
  },
  {
    id: "editor-embed",
    group: "pages",
    kind: "library",
    live: {
      path: "/Service/EditSurvey/{feedbackId}",
      ready: EMBED_READY,
      steps: EMBED_STEPS_LIVE,
      mask: [EMBED_CODE_MASK],
    },
    app: {
      path: "/surveys/{feedbackId}/edit",
      ready: EMBED_READY,
      steps: EMBED_STEPS_APP,
      hide: EDITOR_HIDE_APP,
      mask: [EMBED_CODE_MASK],
    },
    normalize: HEADER_NORMALIZATIONS,
    maxDiffPixelRatio: 0.02,
  },
  {
    id: "history",
    group: "pages",
    kind: "page",
    skip: "Live history is empty for the dedicated account (2026-10-20); re-enable after finding how surveyjs.io records history",
    live: { path: "/Service/History/{feedbackId}", ready: ".my-surveys-history-item" },
    app: { path: "/surveys/{feedbackId}/history", ready: ".my-surveys-history-item" },
    normalize: [
      ...HEADER_NORMALIZATIONS,
      {
        live: ".my-surveys-history-item .action-link span",
        app: ".my-surveys-history-item time",
        text: "1/1/2026, 12:00:00 PM",
        reason: "the entry times are the moments the data was created",
        category: "live-data",
      },
    ],
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "run",
    group: "pages",
    kind: "library",
    live: {
      path: "/published?id={feedbackId}",
      ready: ".sd-question__title",
      hide: [
        {
          selector: ".running-survey__header",
          reason: "ADR 0014 S13: the disclaimer is not built",
          category: "departure",
        },
      ],
    },
    app: { path: "/s/{feedbackId}", ready: ".sd-question__title" },
    maxDiffPixelRatio: 0.02,
  },
  {
    id: "projects",
    group: "pages",
    kind: "element",
    live: {
      path: "/manage#manage-mysurveys",
      ready: PROJECTS_SECTION,
      target: PROJECTS_SECTION,
    },
    app: { path: "/projects", ready: PROJECTS_SECTION, target: PROJECTS_SECTION },
    maxDiffPixelRatio: 0.01,
  },
  {
    id: "projects-expanded",
    group: "pages",
    kind: "element",
    live: {
      path: "/manage#manage-mysurveys",
      ready: PROJECTS_SECTION,
      target: PROJECTS_SECTION,
      steps: [{ click: PROJECT_SUMMARY }],
    },
    app: {
      path: "/projects",
      ready: PROJECTS_SECTION,
      target: PROJECTS_SECTION,
      steps: [{ click: PROJECT_SUMMARY }],
    },
    normalize: [
      {
        live: ".v2-class---account-page__project-user-display-name",
        app: ".v2-class---account-page__project-user-display-name",
        text: "Visual User",
        reason: "the member's display name belongs to the account that made the data",
        category: "live-data",
      },
    ],
    maxDiffPixelRatio: 0.01,
  },
  {
    id: "results-summary",
    group: "results",
    kind: "library",
    ...resultsSide(
      "/Service/SurveyResults/{feedbackId}#summary",
      "/surveys/{feedbackId}/results?tab=summary",
      {
        live: CHARTS_READY,
        app: CHARTS_READY,
      },
      [SUBMITTED_CARD_HIDE_LIVE],
    ),
    normalize: HEADER_NORMALIZATIONS,
    maxDiffPixelRatio: 0.02,
  },
  {
    id: "results-table",
    group: "results",
    kind: "library",
    ...resultsSide(
      "/Service/SurveyResults/{feedbackId}#table",
      "/surveys/{feedbackId}/results?tab=table",
      {
        live: TABLE_READY,
        app: TABLE_READY,
      },
    ),
    normalize: [
      ...HEADER_NORMALIZATIONS,
      {
        live: SUBMITTED_CELLS,
        app: SUBMITTED_CELLS,
        text: "2026-01-01T00:00:00.000Z",
        reason: "the submission times are the moments the data was created",
        category: "live-data",
      },
    ],
    residual: [
      {
        what: "the rows' order: live lists the responses in storage order, the app by submission time",
        reason: "ADR 0015 R3: the app sorts the responses by (submittedAt, id)",
        category: "departure",
      },
    ],
    maxDiffPixelRatio: 0.02,
  },
  {
    id: "results-details",
    group: "results",
    kind: "page",
    live: {
      path: "/Service/SurveyResults/{feedbackId}#info",
      ready: DETAILS_READY,
      idle: RESULTS_IDLE_LIVE,
      hide: RESULTS_HIDE_LIVE,
    },
    app: {
      path: "/surveys/{feedbackId}/results?tab=details",
      ready: DETAILS_READY,
      hide: [BACK_LINK_HIDE_APP],
    },
    normalize: [
      ...HEADER_NORMALIZATIONS,
      {
        live: DETAILS_DATES,
        app: DETAILS_DATES,
        text: "1/1/2026",
        reason: "the first and last response times are the moments the data was created",
        category: "live-data",
      },
    ],
    maxDiffPixelRatio: 0.005,
  },
  {
    id: "public-results",
    group: "results",
    kind: "library",
    live: {
      path: "/Results/Survey/{feedbackResultId}",
      ready: CHARTS_READY,
      idle: RESULTS_IDLE_LIVE,
      hide: [...RESULTS_HIDE_LIVE, ...PUBLIC_SHELL_HIDE_LIVE, SUBMITTED_CARD_HIDE_LIVE],
    },
    app: {
      path: "/results/{feedbackId}",
      ready: CHARTS_READY,
      hide: DASHBOARD_BANNER_HIDE_APP,
    },
    maxDiffPixelRatio: 0.02,
  },
];
