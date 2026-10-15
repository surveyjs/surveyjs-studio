import type {
  ProjectMembership,
  ProjectRecord,
  SurveyDefinition,
  SurveyRecord,
  User,
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

export const fixtureUsers: readonly User[] = [
  ownerUser,
  adminUser,
  memberUser,
  outsiderUser,
  blockedUser,
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

/** NULL ispublished and NULL usecookies, never saved (no definition blob). */
export const surveyDraft: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000002",
  name: "Draft idea",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: OWNER_ID,
  postId: "33333333-0000-4000-8000-a00000000002",
  resultId: "44444444-0000-4000-8000-a00000000002",
  published: false,
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

/** Created through the private API: all-zero creator id becomes null; NULL ispublished and allowaccessresult. */
export const surveyApiCreated: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000008",
  name: "API created",
  owner: { kind: "personal", userId: OWNER_ID },
  creatorId: null,
  postId: "33333333-0000-4000-8000-a00000000008",
  resultId: "44444444-0000-4000-8000-a00000000008",
  published: false,
  archived: false,
  createdAt: "2026-05-30T21:00:00.000Z",
  updatedAt: "2026-06-01T07:45:10.000Z",
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

/** Survey -> its stored definition. Every other fixture survey has no surveyjson blob. */
export const fixtureDefinitions: readonly (readonly [SurveyRecord, SurveyDefinition])[] = [
  [surveyFeedback, fixtureDefinition("Customer feedback")],
  [surveyCampaign, fixtureDefinition("Campaign survey")],
  [surveyRetro, fixtureDefinition("Engineering retro")],
];
export const surveysWithoutDefinition: readonly SurveyRecord[] = [
  surveyDraft,
  surveyOldPoll,
  surveyArchivedCampaign,
  surveyOutsider,
  surveyApiCreated,
];

// ---- Projects, ordered by project name ("Engineering" before "Marketing") ----

/**
 * Owner and creation time come from the creator's membership row (its id equals the project
 * id). The member count counts every OrganizationUsers row of the project.
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
];

/** 7 days before the owner's 2027-06-01 licence expires: the seat and the transfer follow it. */
export const LATER_LICENCE_CLOCK = Date.parse("2027-05-25T00:00:00.000Z");

export const licenceNoticesAtLaterClock: readonly (readonly [string, string, Notice[]])[] = [
  ["the owner", OWNER_ID, [expiredNotice]],
  ["the admin", ADMIN_ID, [expiredNotice]],
  ["the member (seat)", MEMBER_ID, [expiresSoonNotice]],
  ["the outsider (transfer)", OUTSIDER_ID, [expiresSoonNotice]],
  ["the blocked user", BLOCKED_ID, []],
];

/** The admin's licence expires at 2026-09-10T00:00:00Z; "soon" starts exactly 15 days earlier. */
export const adminLicenceBoundary: readonly (readonly [string, string, Notice[]])[] = [
  ["2026-08-26T00:00:00.000Z", "no notice", []],
  ["2026-08-26T00:00:00.001Z", "expires soon", [expiresSoonNotice]],
  ["2026-09-10T00:00:00.000Z", "expires soon", [expiresSoonNotice]],
  ["2026-09-10T00:00:00.001Z", "expired", [expiredNotice]],
];
