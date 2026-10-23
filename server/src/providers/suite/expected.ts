import type {
  ProjectMember,
  ProjectMembership,
  ProjectRecord,
  SurveyDefinition,
  SurveyRecord,
  SurveyResponse,
  SurveyTheme,
  User,
  ViewState,
} from "../../domain/types.js";
import type { Notice } from "../../notices/account-notices.js";

/**
 * Expected domain objects for the golden fixtures in server/fixtures/legacy.
 * Written by hand on purpose: they are NOT computed with the legacy mapping, so the suite checks
 * the mapping instead of repeating it. Change them together with the fixture files.
 */

export const OWNER_ID = "11111111-0000-4000-8000-a00000000001";
export const ADMIN_ID = "11111111-0000-4000-8000-a00000000002";
export const MEMBER_ID = "11111111-0000-4000-8000-a00000000003";
export const OUTSIDER_ID = "11111111-0000-4000-8000-a00000000004";
export const BLOCKED_ID = "11111111-0000-4000-8000-a00000000005";
export const ERASABLE_ID = "11111111-0000-4000-8000-a00000000006";
/** A well-formed id no fixture row uses. */
export const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

export const PROJECT_A_ID = "55555555-0000-4000-8000-a00000000001";
export const PROJECT_B_ID = "55555555-0000-4000-8000-a00000000002";

// ---- Users ----

/** The owner of project A and of the personal surveys. */
export const ownerUser: User = {
  id: OWNER_ID,
  email: "owner@example.com",
  displayName: "Olivia Owner",
  blocked: false,
};

/** Admin of project A (role stored as "Admin") and creator of project B. */
export const adminUser: User = {
  id: ADMIN_ID,
  email: "admin@example.com",
  displayName: "Adam Admin",
  blocked: false,
};

/** Plain member of project A; legacy `blocked` is NULL, so not blocked. */
export const memberUser: User = {
  id: MEMBER_ID,
  email: "member@example.com",
  displayName: "Mia Member",
  blocked: false,
};

/** Shares no project with anyone. */
export const outsiderUser: User = {
  id: OUTSIDER_ID,
  email: "outsider@example.com",
  displayName: "Oscar Outsider",
  blocked: false,
};

/** blocked = 1 and NULL displayname: the display name falls back to the email. */
export const blockedUser: User = {
  id: BLOCKED_ID,
  email: "blocked@example.com",
  displayName: "blocked@example.com",
  blocked: true,
};

/** Has no data at all: the erasure tests erase only this user (and fresh ids). */
export const erasableUser: User = {
  id: ERASABLE_ID,
  email: "erasable@example.com",
  displayName: "Erin Erasable",
  blocked: false,
};

export const fixtureUsers: readonly User[] = [
  ownerUser,
  adminUser,
  memberUser,
  outsiderUser,
  blockedUser,
  erasableUser,
];

// ---- Surveys ----

/** Published, theme, definition, history, layouts and results; all settings on. */
export const surveyFeedback: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000001",
  name: "Customer feedback",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: OWNER_ID,
  postId: "33333333-0000-4000-8000-a00000000001",
  resultId: "44444444-0000-4000-8000-a00000000001",
  published: true,
  archived: false,
  createdAt: "2026-03-13T09:12:00.000Z",
  updatedAt: "2026-04-14T15:30:00.000Z",
  settings: { publicResults: true, storeRespondentIp: true, useCookies: true },
};

/** NULL ispublished (so published) and NULL usecookies, never saved (no definition blob). */
export const surveyDraft: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000002",
  name: "Draft idea",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: OWNER_ID,
  postId: "33333333-0000-4000-8000-a00000000002",
  resultId: "44444444-0000-4000-8000-a00000000002",
  published: true,
  archived: false,
  createdAt: "2026-02-01T08:00:00.000Z",
  updatedAt: "2026-02-02T08:00:00.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

/** Archived personal survey; milliseconds in the update time; the legacy publishid is ignored. */
export const surveyOldPoll: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000003",
  name: "Old poll",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: OWNER_ID,
  postId: "33333333-0000-4000-8000-a00000000003",
  resultId: "44444444-0000-4000-8000-a00000000003",
  published: false,
  archived: true,
  createdAt: "2025-12-10T12:00:00.000Z",
  updatedAt: "2026-05-20T12:00:00.123Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

/** Project A survey created by the member, not by the project owner. */
export const surveyCampaign: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000004",
  name: "Campaign survey",
  owner: { kind: "project", projectId: PROJECT_A_ID },
  creatorId: MEMBER_ID,
  postId: "33333333-0000-4000-8000-a00000000004",
  resultId: "44444444-0000-4000-8000-a00000000004",
  published: true,
  archived: false,
  createdAt: "2026-01-15T13:00:00.000Z",
  updatedAt: "2026-06-10T09:05:00.000Z",
  settings: { publicResults: false, storeRespondentIp: true, useCookies: false },
};

/** Archived project A survey, published and archived at once. */
export const surveyArchivedCampaign: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000005",
  name: "Archived campaign",
  owner: { kind: "project", projectId: PROJECT_A_ID },
  creatorId: OWNER_ID,
  postId: "33333333-0000-4000-8000-a00000000005",
  resultId: "44444444-0000-4000-8000-a00000000005",
  published: true,
  archived: true,
  createdAt: "2025-12-20T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  settings: { publicResults: true, storeRespondentIp: false, useCookies: true },
};

/** The only project B survey, created by the project admin. */
export const surveyRetro: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000006",
  name: "Engineering retro",
  owner: { kind: "project", projectId: PROJECT_B_ID },
  creatorId: ADMIN_ID,
  postId: "33333333-0000-4000-8000-a00000000006",
  resultId: "44444444-0000-4000-8000-a00000000006",
  published: false,
  archived: false,
  createdAt: "2026-02-14T16:00:00.000Z",
  updatedAt: "2026-07-01T16:45:30.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

/** The outsider personal survey. */
export const surveyOutsider: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000007",
  name: "Outsider quiz",
  owner: { kind: "personal", userId: OUTSIDER_ID },
  creatorId: OUTSIDER_ID,
  postId: "33333333-0000-4000-8000-a00000000007",
  resultId: "44444444-0000-4000-8000-a00000000007",
  published: true,
  archived: false,
  createdAt: "2026-04-01T07:00:00.000Z",
  updatedAt: "2026-04-02T07:30:00.000Z",
  settings: { publicResults: false, storeRespondentIp: true, useCookies: true },
};

/**
 * Created through the private API: all-zero creator id becomes null; NULL ispublished (so
 * published) and NULL allowaccessresult.
 */
export const surveyApiCreated: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000008",
  name: "API created",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: null,
  postId: "33333333-0000-4000-8000-a00000000008",
  resultId: "44444444-0000-4000-8000-a00000000008",
  published: true,
  archived: false,
  createdAt: "2026-05-30T21:00:00.000Z",
  updatedAt: "2026-06-01T07:45:10.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

export const XSS_SURVEY_ID = "22222222-0000-4000-8000-a00000000009";

/**
 * "XSS in question name" (R24): markup in its name, question name and title, HTML and completed
 * HTML, shown as text by the list, editor and run page. The member's only personal survey; read
 * only (the e2e answers its submission itself and fails on any definition write).
 */
export const surveyXss: SurveyRecord = {
  id: XSS_SURVEY_ID,
  name: "XSS in question name <img src=x onerror=alert(1)>",
  owner: { kind: "personal", userId: MEMBER_ID },
  creatorId: MEMBER_ID,
  postId: "33333333-0000-4000-8000-a00000000009",
  resultId: "44444444-0000-4000-8000-a00000000009",
  published: true,
  archived: false,
  createdAt: "2026-03-01T09:00:00.000Z",
  updatedAt: "2026-03-01T09:00:00.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

export const fixtureSurveys: readonly SurveyRecord[] = [
  surveyFeedback,
  surveyDraft,
  surveyOldPoll,
  surveyCampaign,
  surveyArchivedCampaign,
  surveyRetro,
  surveyOutsider,
  surveyApiCreated,
  surveyXss,
];

// ---- Survey lists, in the documented order: updatedAt descending, then id ----

export const ownerPersonalSurveys: readonly SurveyRecord[] = [
  surveyApiCreated, // 2026-06-01
  surveyOldPoll, // 2026-05-20
  surveyFeedback, // 2026-04-14
  surveyDraft, // 2026-02-02
];
export const projectASurveys: readonly SurveyRecord[] = [surveyCampaign, surveyArchivedCampaign];
export const projectBSurveys: readonly SurveyRecord[] = [surveyRetro];
export const outsiderSurveys: readonly SurveyRecord[] = [surveyOutsider];

/** The active and the archived part of each list, in list order (`listSurveyPage`). */
export const ownerPersonalActiveSurveys: readonly SurveyRecord[] = [
  surveyApiCreated,
  surveyFeedback,
  surveyDraft,
];
export const ownerPersonalArchivedSurveys: readonly SurveyRecord[] = [surveyOldPoll];
export const projectAActiveSurveys: readonly SurveyRecord[] = [surveyCampaign];
export const projectAArchivedSurveys: readonly SurveyRecord[] = [surveyArchivedCampaign];

// ---- Definitions: the surveyjson blobs in blobs/surveys/surveyjson ----

/** The three saved fixture surveys share one page layout; only the title differs. */
const fixtureDefinition = (title: string): SurveyDefinition => ({
  title,
  pages: [
    {
      name: "page1",
      elements: [
        { type: "rating", name: "satisfaction", title: "How satisfied are you?" },
        { type: "file", name: "receipt", title: "Upload your receipt" },
      ],
    },
  ],
});

/** The definition of "API created" (`…a08`), the survey with the 1,500 generated responses. */
export const largeSurveyDefinition: SurveyDefinition = {
  title: "API created",
  pages: [
    {
      name: "page1",
      elements: [
        {
          type: "radiogroup",
          name: "color",
          title: "Favourite colour",
          choices: ["Red", "Green", "Blue"],
        },
        { type: "rating", name: "score", title: "How likely are you to recommend us?" },
        { type: "boolean", name: "subscribe", title: "Subscribe to the newsletter?" },
        {
          type: "checkbox",
          name: "channels",
          title: "Where did you hear about us?",
          choices: ["Search", "Friend", "Social", "Ad"],
        },
        { type: "text", name: "comment", title: "Any comments?" },
      ],
    },
  ],
};

/** The definition of "XSS in question name" (`…a09`): every piece of markup is meant as text. */
export const xssDefinition: SurveyDefinition = {
  title: "XSS in question name <img src=x onerror=alert(1)>",
  completedHtml: "<p>Thank you, {q1}.</p><img src=x onerror=alert(5)>",
  pages: [
    {
      name: "page1",
      elements: [
        { type: "text", name: "<img src=x onerror=alert(2)>", title: "<script>alert(3)</script>" },
        { type: "html", name: "greeting", html: "<p>Hello, {q1}.</p><img src=x onerror=alert(4)>" },
      ],
    },
  ],
};

/** Survey -> its stored definition. Every other fixture survey has no surveyjson blob. */
export const fixtureDefinitions: readonly (readonly [SurveyRecord, SurveyDefinition])[] = [
  [surveyFeedback, fixtureDefinition("Customer feedback")],
  [surveyCampaign, fixtureDefinition("Campaign survey")],
  [surveyRetro, fixtureDefinition("Engineering retro")],
  [surveyApiCreated, largeSurveyDefinition],
  [surveyXss, xssDefinition],
];
/** The theme of fixture 01 (`Surveys.theme`); no other fixture survey has one. */
export const feedbackTheme: SurveyTheme = {
  themeName: "default",
  colorPalette: "light",
  cssVariables: { "--sjs-primary-backcolor": "#19b394" },
};
export const surveysWithoutDefinition: readonly SurveyRecord[] = [
  surveyDraft,
  surveyOldPoll,
  surveyArchivedCampaign,
  surveyOutsider,
];

// ---- Projects, ordered by project name ("Engineering" before "Marketing") ----

/**
 * Owner and creation time come from the creator's membership row (its id equals the project
 * id). The owner is the creator while still a member (R2): without that row it is null, never
 * another member. The member count counts every OrganizationUsers row of the project.
 */
export const projectA: ProjectRecord = {
  id: PROJECT_A_ID,
  name: "Marketing",
  ownerId: OWNER_ID,
  createdAt: "2025-11-21T10:00:00.000Z",
  memberCount: 3, // owner, admin, member
};
/** Organizations.happendat moved to 2025-12-05 with a rename; the creator's row keeps 2025-12-01. */
export const projectB: ProjectRecord = {
  id: PROJECT_B_ID,
  name: "Engineering",
  ownerId: ADMIN_ID,
  createdAt: "2025-12-01T09:00:00.000Z",
  memberCount: 2, // admin, owner
};

export const ownerProjects: readonly ProjectMembership[] = [
  { project: projectB, role: "user" }, // joined project B
  { project: projectA, role: "admin" }, // created project A
];
export const adminProjects: readonly ProjectMembership[] = [
  { project: projectB, role: "admin" }, // created project B
  { project: projectA, role: "admin" }, // stored as "Admin" after a role change
];
export const memberProjects: readonly ProjectMembership[] = [{ project: projectA, role: "user" }];

/**
 * Only the fixture projects of a list, in list order. Tests create and delete their own projects
 * with fixture users as members, and the Azurite replica keeps any a failed run left behind, so
 * the project lists of fixture users are checked by membership (R25).
 */
export const fixtureProjectsOnly = (list: readonly ProjectMembership[]): ProjectMembership[] =>
  list.filter(({ project }) => project.id === PROJECT_A_ID || project.id === PROJECT_B_ID);

/** By display name ignoring case, then user id; one entry per user. */
export const projectAMembers: readonly ProjectMember[] = [
  { user: adminUser, role: "admin" }, // stored as "Admin"
  { user: memberUser, role: "user" },
  { user: ownerUser, role: "admin" }, // the creator
];
export const projectBMembers: readonly ProjectMember[] = [
  { user: adminUser, role: "admin" }, // the creator
  { user: ownerUser, role: "user" },
];

// ---- Licence notices (ACCOUNT_NOTICES=surveyjs-licenses), fixtures sql/UserLicenses.json and
// sql/LicenseTransfers.json ----

/** The surveyjs.io "expired" dialog as a notice. */
export const expiredNotice: Notice = {
  code: "license-expired",
  message: "Your renewal subscription has expired.",
  actionUrl: "https://surveyjs.io/manage",
  actionLabel: "Renew",
};

/** The surveyjs.io "expires soon" dialog as a notice. */
export const expiresSoonNotice: Notice = {
  code: "license-expires-soon",
  message: "Your renewal subscription expires soon.",
  actionUrl: "https://surveyjs.io/manage",
  actionLabel: "Renew",
};

/** The fixed clock of the licence cases. */
export const LICENCE_CLOCK = Date.parse("2026-09-01T12:00:00.000Z");

/**
 * Notices at LICENCE_CLOCK. Owner: one licence expired 2026-08-01, one valid till 2027-06-01.
 * Admin: one licence that expires 2026-09-10 (8.5 days left). Member: a developer seat of the
 * owner's 2027 licence whose own (stale) date is 2020-01-01; the parent's date counts. Outsider:
 * a licence without an expiry date and a transfer of the owner's 2027 licence. Blocked: none.
 */
export const licenceNoticesAtClock: readonly (readonly [string, string, Notice[]])[] = [
  ["the owner (expired)", OWNER_ID, [expiredNotice]],
  ["the admin (expires soon)", ADMIN_ID, [expiresSoonNotice]],
  ["the member (seat of a valid licence)", MEMBER_ID, []],
  ["the outsider (no date, valid transfer)", OUTSIDER_ID, []],
  ["the blocked user (no licences)", BLOCKED_ID, []],
  ["the erasure user (no licences)", ERASABLE_ID, []],
];

/** 7 days before the owner's 2027-06-01 licence expires: the seat and the transfer follow it. */
export const LATER_LICENCE_CLOCK = Date.parse("2027-05-25T00:00:00.000Z");

export const licenceNoticesAtLaterClock: readonly (readonly [string, string, Notice[]])[] = [
  ["the owner", OWNER_ID, [expiredNotice]],
  ["the admin", ADMIN_ID, [expiredNotice]],
  ["the member (seat)", MEMBER_ID, [expiresSoonNotice]],
  ["the outsider (transfer)", OUTSIDER_ID, [expiresSoonNotice]],
  ["the blocked user", BLOCKED_ID, []],
  ["the erasure user (no licences)", ERASABLE_ID, []],
];

/** The admin's licence expires at 2026-09-10T00:00:00Z; "soon" starts exactly 15 days earlier. */
export const adminLicenceBoundary: readonly (readonly [string, string, Notice[]])[] = [
  ["2026-08-26T00:00:00.000Z", "no notice", []],
  ["2026-08-26T00:00:00.001Z", "expires soon", [expiresSoonNotice]],
  ["2026-09-10T00:00:00.000Z", "expires soon", [expiresSoonNotice]],
  ["2026-09-10T00:00:00.001Z", "expired", [expiredNotice]],
];

// ---- History: the points in blobs/surveys/surveyjsonhistory ----

/** The two legacy points of fixture 01; the fixtures carry no time or user for them. */
export const feedbackHistoryIds: readonly string[] = [
  "88888888-0000-4000-8000-a00000000001",
  "88888888-0000-4000-8000-a00000000002",
];

/** Point id to the definition stored in that point. */
export const feedbackHistorySnapshots: Readonly<Record<string, SurveyDefinition>> = {
  "88888888-0000-4000-8000-a00000000001": fixtureDefinition("Customer feedback (draft)"),
  "88888888-0000-4000-8000-a00000000002": fixtureDefinition("Customer feedback"),
};

// ---- Results ----

const RECEIPT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The five fixture responses of one post table: ids 66666666-...-a000000000{base+1..5}, on `day`. */
const fixtureResponses = (
  idPrefix: string,
  day: string,
  clientId: string,
): readonly SurveyResponse[] => [
  {
    id: `66666666-0000-4000-8000-a000000000${idPrefix}1`,
    submittedAt: `${day}T08:00:00.500Z`,
    data: { satisfaction: 4 },
    partial: false,
  },
  {
    id: `66666666-0000-4000-8000-a000000000${idPrefix}2`,
    submittedAt: `${day}T09:15:00.000Z`,
    data: { satisfaction: 2 },
    clientId,
    partial: true,
  },
  {
    id: `66666666-0000-4000-8000-a000000000${idPrefix}3`,
    submittedAt: `${day}T10:30:00.000Z`,
    data: { satisfaction: 5 },
    respondentIp: "203.0.113.7",
    partial: false,
  },
  {
    id: `66666666-0000-4000-8000-a000000000${idPrefix}4`,
    submittedAt: `${day}T11:45:00.000Z`,
    data: {
      satisfaction: 3,
      receipt: [{ name: "receipt.png", type: "image/png", content: RECEIPT_PNG }],
    },
    partial: false,
  },
  {
    id: `66666666-0000-4000-8000-a000000000${idPrefix}5`,
    submittedAt: `${day}T12:00:00.000Z`,
    data: { satisfaction: 1, receipt: "dxsimage:99999999-0000-4000-8000-a00000000002.png" },
    partial: false,
  },
];

/** Responses of fixture 01, in list order. Row 02 is a legacy partial response of client-0001. */
export const feedbackResponses: readonly SurveyResponse[] = fixtureResponses(
  "0",
  "2026-04-01",
  "client-0001",
);

/** Responses of fixture 04, in list order. Row 12 is a legacy partial response of client-0002. */
export const campaignResponses: readonly SurveyResponse[] = fixtureResponses(
  "1",
  "2026-04-02",
  "client-0002",
);

// ---- The generated responses of "API created" (`…a08`), see azure-legacy/large-survey.ts ----

/** The id of generated response `n` (1 to 1,500): an independent copy of the generator's rule. */
export const largeSurveyId = (n: number): string =>
  `66666666-0000-4000-8000-c${n.toString(16).padStart(11, "0")}`;

/** Generated response 1. */
export const largeSurveyFirst: SurveyResponse = {
  id: "66666666-0000-4000-8000-c00000000001",
  submittedAt: "2026-05-01T08:00:00.000Z",
  data: { color: "Red", score: 1, subscribe: false, channels: ["Search"] },
  partial: false,
};

/** Generated response 500, the last of a 500-row page; ties with 501 at the same minute. */
export const largeSurvey500: SurveyResponse = {
  id: "66666666-0000-4000-8000-c000000001f4",
  submittedAt: "2026-05-01T12:10:00.000Z",
  data: { color: "Green", score: 5, subscribe: true, channels: ["Ad"], comment: "Comment 500" },
  partial: false,
};

/** Generated response 501, the first of the second page. */
export const largeSurvey501: SurveyResponse = {
  id: "66666666-0000-4000-8000-c000000001f5",
  submittedAt: "2026-05-01T12:10:00.000Z",
  data: { color: "Blue", score: 1, subscribe: false, channels: ["Search"] },
  partial: false,
};

/** Generated response 1,500. */
export const largeSurveyLast: SurveyResponse = {
  id: "66666666-0000-4000-8000-c000000005dc",
  submittedAt: "2026-05-01T20:30:00.000Z",
  data: { color: "Blue", score: 5, subscribe: true, channels: ["Ad"], comment: "Comment 1500" },
  partial: false,
};

// ---- Legacy layouts of fixture 01: the blobs in surveyresultsummarystate and surveyresulttablestate ----

export const legacyFeedbackSummaryView: ViewState = {
  elements: [
    { name: "satisfaction", isPublic: true },
    { name: "receipt", isPublic: false },
  ],
};

export const legacyFeedbackTableView: ViewState = {
  locale: "",
  elements: [
    {
      name: "satisfaction",
      displayName: "How satisfied are you?",
      isVisible: true,
      isPublic: true,
    },
    { name: "receipt", displayName: "Upload your receipt", isVisible: true, isPublic: false },
  ],
  pageSize: 10,
};

/** The private questions of fixture 01 (legacy blob `surveyresultpermissions`). */
export const feedbackPrivateQuestions: readonly string[] = ["receipt"];
