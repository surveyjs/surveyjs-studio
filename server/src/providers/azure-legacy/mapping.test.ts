import { describe, expect, it } from "vitest";
import {
  UnmappableLegacyRowError,
  definitionFromLegacy,
  isGuid,
  licenceExpiriesFromLegacy,
  membershipFromLegacy,
  projectFromLegacy,
  responseFromLegacy,
  surveyFromLegacy,
  userFromLegacy,
} from "./mapping.js";
import type { ProjectRecord } from "../../domain/types.js";
import type {
  LegacyLicenceRow,
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacyResultEntity,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

const surveyRow = (over: Partial<LegacySurveyRow> = {}): LegacySurveyRow => ({
  id: "AAAAAAAA-0000-4000-8000-000000000001",
  name: "Customer feedback",
  userid: "11111111-0000-4000-8000-00000000AAAA",
  creatorid: "11111111-0000-4000-8000-00000000BBBB",
  postid: "BBBBBBBB-0000-4000-8000-000000000001",
  resultid: "CCCCCCCC-0000-4000-8000-000000000001",
  createdat: new Date("2023-11-20T09:00:00.000Z"),
  timestamp: new Date("2024-01-02T03:04:05.678Z"),
  ispublished: 1,
  isarchived: 0,
  allowaccessresult: 1,
  storeipaddress: "1",
  usecookies: 1,
  ...over,
});

describe("surveyFromLegacy", () => {
  it("lower-cases GUIDs and maps ids and name", () => {
    const s = surveyFromLegacy(surveyRow(), "personal");
    expect(s.id).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(s.postId).toBe("bbbbbbbb-0000-4000-8000-000000000001");
    expect(s.resultId).toBe("cccccccc-0000-4000-8000-000000000001");
    expect(s.creatorId).toBe("11111111-0000-4000-8000-00000000bbbb");
    expect(s.name).toBe("Customer feedback");
  });

  it("maps userid to a personal or a project owner", () => {
    expect(surveyFromLegacy(surveyRow(), "personal").owner).toEqual({
      kind: "personal",
      userId: "11111111-0000-4000-8000-00000000aaaa",
    });
    expect(surveyFromLegacy(surveyRow(), "project").owner).toEqual({
      kind: "project",
      projectId: "11111111-0000-4000-8000-00000000aaaa",
    });
  });

  it("maps an all-zero creatorid to null", () => {
    const s = surveyFromLegacy(
      surveyRow({ creatorid: "00000000-0000-0000-0000-000000000000" }),
      "personal",
    );
    expect(s.creatorId).toBeNull();
  });

  it("maps createdat and timestamp to ISO UTC", () => {
    const s = surveyFromLegacy(surveyRow(), "personal");
    expect(s.createdAt).toBe("2023-11-20T09:00:00.000Z");
    expect(s.updatedAt).toBe("2024-01-02T03:04:05.678Z");
  });

  it("maps ispublished 1 to true and 0 or NULL to false", () => {
    expect(surveyFromLegacy(surveyRow({ ispublished: 1 }), "personal").published).toBe(true);
    expect(surveyFromLegacy(surveyRow({ ispublished: 0 }), "personal").published).toBe(false);
    expect(surveyFromLegacy(surveyRow({ ispublished: null }), "personal").published).toBe(false);
  });

  it("maps the tinyint flags: 1 is true, anything else false", () => {
    const on = surveyFromLegacy(
      surveyRow({ isarchived: 1, allowaccessresult: 1, usecookies: 1 }),
      "personal",
    );
    expect(on.archived).toBe(true);
    expect(on.settings.publicResults).toBe(true);
    expect(on.settings.useCookies).toBe(true);
    const off = surveyFromLegacy(
      surveyRow({ isarchived: 0, allowaccessresult: null, usecookies: null }),
      "personal",
    );
    expect(off.archived).toBe(false);
    expect(off.settings.publicResults).toBe(false);
    expect(off.settings.useCookies).toBe(false);
  });

  it("treats only the string 1 in storeipaddress as true", () => {
    const ip = (v: string | null) =>
      surveyFromLegacy(surveyRow({ storeipaddress: v }), "personal").settings.storeRespondentIp;
    expect(ip("1")).toBe(true);
    expect(ip("0")).toBe(false);
    expect(ip("True")).toBe(false);
    expect(ip(null)).toBe(false);
  });

  describe("NULL columns", () => {
    it("maps a NULL name to an empty string", () => {
      expect(surveyFromLegacy(surveyRow({ name: null }), "personal").name).toBe("");
    });

    it("maps a NULL creatorid to null", () => {
      expect(surveyFromLegacy(surveyRow({ creatorid: null }), "personal").creatorId).toBeNull();
    });

    it("uses timestamp for a NULL createdat and createdat for a NULL timestamp", () => {
      const noCreated = surveyFromLegacy(surveyRow({ createdat: null }), "personal");
      expect(noCreated.createdAt).toBe("2024-01-02T03:04:05.678Z");
      expect(noCreated.updatedAt).toBe("2024-01-02T03:04:05.678Z");
      const noUpdated = surveyFromLegacy(surveyRow({ timestamp: null }), "personal");
      expect(noUpdated.createdAt).toBe("2023-11-20T09:00:00.000Z");
      expect(noUpdated.updatedAt).toBe("2023-11-20T09:00:00.000Z");
    });

    it("uses the epoch when both dates are NULL", () => {
      const s = surveyFromLegacy(surveyRow({ createdat: null, timestamp: null }), "personal");
      expect(s.createdAt).toBe("1970-01-01T00:00:00.000Z");
      expect(s.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    });

    it.each(["postid", "resultid", "userid"] as const)(
      "refuses a row with a NULL %s and names only the survey id",
      (column) => {
        let error: unknown;
        try {
          surveyFromLegacy(surveyRow({ [column]: null }), "personal");
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(UnmappableLegacyRowError);
        expect((error as UnmappableLegacyRowError).ids).toEqual({
          surveyId: "aaaaaaaa-0000-4000-8000-000000000001",
        });
        expect((error as Error).message).not.toContain("Customer feedback");
      },
    );
  });
});

describe("definitionFromLegacy", () => {
  const SURVEY = "AAAAAAAA-0000-4000-8000-000000000001";

  it("parses the blob text", () => {
    const definition = { title: "Größe ✓", pages: [{ name: "page1" }] };
    expect(definitionFromLegacy(SURVEY, JSON.stringify(definition))).toEqual(definition);
  });

  it.each(["", " \t "])("reads an empty blob %j as an empty survey", (text) => {
    expect(definitionFromLegacy(SURVEY, text)).toEqual({});
  });

  it.each(['{"title": "cut', "[1, 2]", "null", '"text"', "42"])(
    "refuses %j with the survey id only",
    (text) => {
      const error = (() => {
        try {
          definitionFromLegacy(SURVEY, text);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(UnmappableLegacyRowError);
      expect((error as UnmappableLegacyRowError).ids).toEqual({
        surveyId: "aaaaaaaa-0000-4000-8000-000000000001",
      });
      expect((error as Error).message).not.toContain("cut");
    },
  );
});

describe("isGuid", () => {
  it.each(["aaaaaaaa-0000-4000-8000-000000000001", "AAAAAAAA-0000-4000-8000-00000000000F"])(
    "accepts %j",
    (value) => {
      expect(isGuid(value)).toBe(true);
    },
  );

  it.each([
    "",
    "personal",
    "aaaaaaaa00004000800000000000001",
    "aaaaaaaa-0000-4000-8000-00000000000g",
  ])("refuses %j", (value) => {
    expect(isGuid(value)).toBe(false);
  });
});

describe("responseFromLegacy", () => {
  const entity = (over: Partial<LegacyResultEntity> = {}): LegacyResultEntity => ({
    id: "DDDDDDDD-0000-4000-8000-000000000001",
    happendat: new Date("2024-02-03T04:05:06.789Z"),
    result: '{"q1":"a","q2":[1,2]}',
    ...over,
  });

  it("maps InstanceId, HappendAt and the parsed result", () => {
    const r = responseFromLegacy(entity());
    expect(r.id).toBe("dddddddd-0000-4000-8000-000000000001");
    expect(r.submittedAt).toBe("2024-02-03T04:05:06.789Z");
    expect(r.data).toEqual({ q1: "a", q2: [1, 2] });
  });

  it("does not decode HTML entities", () => {
    expect(responseFromLegacy(entity({ result: '{"q1":"a &amp; b"}' })).data).toEqual({
      q1: "a &amp; b",
    });
  });

  it("omits optional fields when absent and defaults partial to false", () => {
    const r = responseFromLegacy(entity());
    expect(r).not.toHaveProperty("clientId");
    expect(r).not.toHaveProperty("respondentIp");
    expect(r.partial).toBe(false);
  });

  it("includes optional fields when present", () => {
    const r = responseFromLegacy(
      entity({ clientid: "client-1", ipaddress: "203.0.113.7", ispartialcompleted: true }),
    );
    expect(r.clientId).toBe("client-1");
    expect(r.respondentIp).toBe("203.0.113.7");
    expect(r.partial).toBe(true);
  });
});

describe("userFromLegacy", () => {
  const user = (over: Partial<LegacyUserRow> = {}): LegacyUserRow => ({
    id: "11111111-0000-4000-8000-00000000AAAA",
    email: "owner@example.com",
    displayname: "Owner",
    blocked: 0,
    ...over,
  });

  it("maps fields and lower-cases the id", () => {
    expect(userFromLegacy(user())).toEqual({
      id: "11111111-0000-4000-8000-00000000aaaa",
      email: "owner@example.com",
      displayName: "Owner",
      blocked: false,
    });
  });

  it("falls back to the email when displayname is null or blank", () => {
    expect(userFromLegacy(user({ displayname: null })).displayName).toBe("owner@example.com");
    expect(userFromLegacy(user({ displayname: "   " })).displayName).toBe("owner@example.com");
  });

  it("maps a NULL email to an empty string, the display name falling back to it", () => {
    expect(userFromLegacy(user({ email: null }))).toMatchObject({
      email: "",
      displayName: "Owner",
    });
    expect(userFromLegacy(user({ email: null, displayname: null })).displayName).toBe("");
  });

  it("maps blocked 1 to true", () => {
    expect(userFromLegacy(user({ blocked: 1 })).blocked).toBe(true);
    expect(userFromLegacy(user({ blocked: null })).blocked).toBe(false);
  });
});

describe("projectFromLegacy", () => {
  const ORG_ID = "55555555-0000-4000-8000-00000000AAAA";
  const org = (over: Partial<LegacyOrganizationRow> = {}): LegacyOrganizationRow => ({
    id: ORG_ID,
    name: "Example project",
    happendat: new Date("2025-06-01T12:00:00.000Z"),
    ...over,
  });
  const row = (
    id: string,
    userid: string,
    role: string | null,
    happendat: string | null,
  ): LegacyOrganizationUserRow => ({
    id,
    organizationid: ORG_ID,
    userid,
    role,
    happendat: happendat === null ? null : new Date(happendat),
  });
  const USER_1 = "11111111-0000-4000-8000-0000000000A1";
  const USER_2 = "11111111-0000-4000-8000-0000000000A2";
  const USER_3 = "11111111-0000-4000-8000-0000000000A3";
  /** The creator's row: its id equals the organization id. */
  const creator = (role: string, happendat: string | null) => row(ORG_ID, USER_3, role, happendat);
  const admin = (userid: string, happendat: string | null) =>
    row(`AAAAAAAA-0000-4000-8000-0000000000${userid.slice(-2)}`, userid, "Admin", happendat);
  const member = (userid: string, happendat: string | null) =>
    row(`BBBBBBBB-0000-4000-8000-0000000000${userid.slice(-2)}`, userid, "user", happendat);

  it("takes owner and creation time from the creator's row, lower-casing ids", () => {
    const rows = [
      admin(USER_1, "2025-01-01T00:00:00.000Z"),
      creator("user", "2025-03-01T00:00:00.000Z"),
      member(USER_2, "2024-12-01T00:00:00.000Z"),
    ];
    expect(projectFromLegacy(org(), rows)).toEqual<ProjectRecord>({
      id: "55555555-0000-4000-8000-00000000aaaa",
      name: "Example project",
      ownerId: "11111111-0000-4000-8000-0000000000a3",
      createdAt: "2025-03-01T00:00:00.000Z",
      memberCount: 3,
    });
  });

  it("finds the creator's row whatever the case of its id", () => {
    const rows = [row(ORG_ID.toLowerCase(), USER_3, "admin", "2025-03-01T00:00:00.000Z")];
    expect(projectFromLegacy(org(), rows).ownerId).toBe("11111111-0000-4000-8000-0000000000a3");
  });

  it("falls back to the earliest admin, any role case, when the creator's row is missing", () => {
    const rows = [
      member(USER_3, "2024-01-01T00:00:00.000Z"),
      admin(USER_2, "2025-02-01T00:00:00.000Z"),
      row("CCCCCCCC-0000-4000-8000-000000000001", USER_1, "ADMIN", "2025-01-01T00:00:00.000Z"),
    ];
    expect(projectFromLegacy(org(), rows).ownerId).toBe("11111111-0000-4000-8000-0000000000a1");
  });

  it("breaks a tie between admins by the smaller user id", () => {
    const at = "2025-01-01T00:00:00.000Z";
    const rows = [admin(USER_2, at), admin(USER_1, at)];
    expect(projectFromLegacy(org(), rows).ownerId).toBe("11111111-0000-4000-8000-0000000000a1");
  });

  it("puts admins with a NULL happendat after dated ones", () => {
    const rows = [admin(USER_1, null), admin(USER_2, "2025-05-01T00:00:00.000Z")];
    expect(projectFromLegacy(org(), rows).ownerId).toBe("11111111-0000-4000-8000-0000000000a2");
  });

  it("falls back to the earliest member of any role when there is no admin", () => {
    const rows = [
      member(USER_1, "2025-02-01T00:00:00.000Z"),
      row("CCCCCCCC-0000-4000-8000-000000000001", USER_2, null, "2025-01-01T00:00:00.000Z"),
    ];
    expect(projectFromLegacy(org(), rows).ownerId).toBe("11111111-0000-4000-8000-0000000000a2");
  });

  it("uses Organizations.happendat when there is no creator's row", () => {
    const rows = [admin(USER_1, "2025-01-01T00:00:00.000Z")];
    expect(projectFromLegacy(org(), rows).createdAt).toBe("2025-06-01T12:00:00.000Z");
  });

  it("uses Organizations.happendat when the creator's row has a NULL happendat", () => {
    expect(projectFromLegacy(org(), [creator("admin", null)]).createdAt).toBe(
      "2025-06-01T12:00:00.000Z",
    );
  });

  it("uses the epoch when both times are NULL", () => {
    expect(projectFromLegacy(org({ happendat: null }), [creator("admin", null)]).createdAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("counts every membership row, whatever its role", () => {
    const rows = [
      creator("admin", null),
      member(USER_1, null),
      row("CCCCCCCC-0000-4000-8000-000000000001", USER_2, null, null),
      row("CCCCCCCC-0000-4000-8000-000000000002", USER_3, "owner", null),
    ];
    expect(projectFromLegacy(org(), rows).memberCount).toBe(4);
  });

  it("maps a NULL project name to an empty string", () => {
    expect(projectFromLegacy(org({ name: null }), [creator("admin", null)]).name).toBe("");
  });

  it("refuses a project without membership rows, naming only the project id", () => {
    expect(() => projectFromLegacy(org(), [])).toThrow(
      expect.objectContaining({
        name: "UnmappableLegacyRowError",
        ids: { organizationId: "55555555-0000-4000-8000-00000000aaaa" },
      }),
    );
  });
});

describe("membershipFromLegacy", () => {
  const project: ProjectRecord = {
    id: "55555555-0000-4000-8000-00000000aaaa",
    name: "Example project",
    ownerId: "11111111-0000-4000-8000-000000000001",
    createdAt: "2025-06-01T12:00:00.000Z",
    memberCount: 2,
  };
  const member = (role: string | null): LegacyOrganizationUserRow => ({
    id: "AAAAAAAA-0000-4000-8000-0000000000CC",
    organizationid: "55555555-0000-4000-8000-00000000AAAA",
    userid: "11111111-0000-4000-8000-000000000001",
    role,
    happendat: null,
  });

  it("pairs the project record with the member's role", () => {
    expect(membershipFromLegacy(project, member("user"))).toEqual({ project, role: "user" });
  });

  it("compares the role case-insensitively", () => {
    expect(membershipFromLegacy(project, member("Admin")).role).toBe("admin");
    expect(membershipFromLegacy(project, member("USER")).role).toBe("user");
  });

  it("throws on an unknown role", () => {
    expect(() => membershipFromLegacy(project, member("owner"))).toThrow(/role/i);
  });

  it.each(["owner", null])(
    "refuses role %j with an error that names only the membership and project ids",
    (role) => {
      let error: unknown;
      try {
        membershipFromLegacy(project, member(role));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UnmappableLegacyRowError);
      expect((error as UnmappableLegacyRowError).ids).toEqual({
        membershipId: "aaaaaaaa-0000-4000-8000-0000000000cc",
        organizationId: "55555555-0000-4000-8000-00000000aaaa",
      });
    },
  );
});

describe("licenceExpiriesFromLegacy", () => {
  const ZERO = "00000000-0000-0000-0000-000000000000";
  const own = new Date("2026-08-01T00:00:00.000Z");
  const parents = new Date("2027-06-01T00:00:00.000Z");
  const licence = (over: Partial<LegacyLicenceRow> = {}): LegacyLicenceRow => ({
    id: "BBBBBBBB-0000-4000-8000-000000000001",
    expirationdate: own,
    parentlicenseid: null,
    parentid: null,
    parentexpirationdate: null,
    ...over,
  });

  it("uses the licence's own expiry when it has no parent", () => {
    expect(licenceExpiriesFromLegacy([licence()])).toEqual([own]);
    expect(licenceExpiriesFromLegacy([licence({ parentlicenseid: ZERO })])).toEqual([own]);
  });

  it("uses the parent's expiry for a developer seat", () => {
    const seat = licence({
      parentlicenseid: "BBBBBBBB-0000-4000-8000-000000000002",
      parentid: "BBBBBBBB-0000-4000-8000-000000000002",
      parentexpirationdate: parents,
    });
    expect(licenceExpiriesFromLegacy([seat])).toEqual([parents]);
    expect(licenceExpiriesFromLegacy([{ ...seat, parentexpirationdate: null }])).toEqual([null]);
  });

  it("keeps a NULL expiry as null (the rule ignores it)", () => {
    expect(licenceExpiriesFromLegacy([licence({ expirationdate: null })])).toEqual([null]);
  });

  it("throws, naming the seat, when a developer seat's parent licence is missing", () => {
    const orphan = licence({ parentlicenseid: "BBBBBBBB-0000-4000-8000-000000000009" });
    expect(() => licenceExpiriesFromLegacy([licence(), orphan])).toThrow(UnmappableLegacyRowError);
    expect(() => licenceExpiriesFromLegacy([orphan])).toThrow(
      expect.objectContaining({ ids: { licenceId: "bbbbbbbb-0000-4000-8000-000000000001" } }),
    );
  });
});
