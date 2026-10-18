import { beforeEach, describe, expect, it } from "vitest";
import {
  UnmappableLegacyRowError,
  definitionFromLegacy,
  fileRecordFromBlob,
  historyEntryFromBlob,
  isGuid,
  licenceExpiriesFromLegacy,
  membershipFromLegacy,
  privateQuestionsFromLegacy,
  privateQuestionsToLegacy,
  projectFromLegacy,
  responseFromLegacy,
  surveyFromLegacy,
  themeFromLegacy,
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

describe("themeFromLegacy", () => {
  const SURVEY = "AAAAAAAA-0000-4000-8000-000000000001";
  const warnings: { details: Readonly<Record<string, string>>; message: string }[] = [];
  const logger = {
    warn: (details: Readonly<Record<string, string>>, message: string) => {
      warnings.push({ details, message });
    },
  };
  beforeEach(() => {
    warnings.length = 0;
  });

  it("parses the column text", () => {
    const theme = { themeName: "default", cssVariables: { "--sjs-primary-backcolor": "#19b394" } };
    expect(themeFromLegacy(SURVEY, JSON.stringify(theme), logger)).toEqual(theme);
    expect(warnings).toEqual([]);
  });

  it.each([null, "", " 	 "])("reads %j as no theme", (text) => {
    expect(themeFromLegacy(SURVEY, text, logger)).toEqual({});
    expect(warnings).toEqual([]);
  });

  it.each(['{"themeName": "cut', "[1, 2]", "null", '"text"', "42"])(
    "reads %j as no theme and warns with the survey id only",
    (text) => {
      expect(themeFromLegacy(SURVEY, text, logger)).toEqual({});
      expect(warnings).toEqual([
        {
          details: { surveyId: "aaaaaaaa-0000-4000-8000-000000000001" },
          message: expect.any(String),
        },
      ]);
      expect(warnings[0]!.message).not.toContain("cut");
      expect(warnings[0]!.message).not.toContain(text);
    },
  );
});

describe("historyEntryFromBlob", () => {
  const SURVEY = "22222222-0000-4000-8000-A00000000001";
  const POINT = "88888888-0000-4000-8000-A00000000001";
  const USER = "11111111-0000-4000-8000-A00000000002";
  const name = `${SURVEY.toLowerCase()}/${POINT.toLowerCase()}`;
  const modified = new Date("2026-05-06T07:08:09.000Z");

  it("takes the time and the user from the metadata, lower-casing ids", () => {
    expect(
      historyEntryFromBlob(
        SURVEY,
        name,
        { userid: USER, savedat: "2026-09-01T10:00:05.123Z" },
        modified,
      ),
    ).toEqual({
      id: POINT.toLowerCase(),
      at: "2026-09-01T10:00:05.123Z",
      userId: USER.toLowerCase(),
    });
  });

  it("uses the last-modified time and no user for a legacy point without metadata", () => {
    const expected = { id: POINT.toLowerCase(), at: modified.toISOString(), userId: null };
    expect(historyEntryFromBlob(SURVEY, name, undefined, modified)).toEqual(expected);
    expect(historyEntryFromBlob(SURVEY, name, {}, modified)).toEqual(expected);
  });

  it("reads a userid that is not a GUID as no user", () => {
    for (const userid of ["", "someone", `${USER}x`, "{" + USER + "}"]) {
      expect(historyEntryFromBlob(SURVEY, name, { userid }, modified)?.userId, userid).toBeNull();
    }
  });

  it("uses the last-modified time when savedat does not parse as ISO 8601 UTC", () => {
    for (const savedat of [
      "",
      "yesterday",
      "2026-09-01",
      "2026-09-01T10:00:05+02:00",
      "2026-13-45T99:00:00Z",
    ]) {
      expect(historyEntryFromBlob(SURVEY, name, { savedat }, modified)?.at, savedat).toBe(
        modified.toISOString(),
      );
    }
  });

  it("normalises a savedat without milliseconds", () => {
    expect(
      historyEntryFromBlob(SURVEY, name, { savedat: "2026-09-01T10:00:05Z" }, modified)?.at,
    ).toBe("2026-09-01T10:00:05.000Z");
  });

  it("ignores blobs outside {surveyId}/ and names that are not a GUID point", () => {
    const other = "22222222-0000-4000-8000-a00000000002";
    for (const blob of [
      POINT.toLowerCase(),
      `${other}/${POINT.toLowerCase()}`,
      `${name}/extra`,
      `${SURVEY.toLowerCase()}/not-a-guid`,
      `${SURVEY.toLowerCase()}/`,
      `${SURVEY.toLowerCase()}${POINT.toLowerCase()}`,
    ]) {
      expect(historyEntryFromBlob(SURVEY, blob, undefined, modified), blob).toBeNull();
    }
  });
});

describe("fileRecordFromBlob", () => {
  const SURVEY = "22222222-0000-4000-8000-a00000000001";
  const ID = `22222222000040008000a00000000001${"ab".repeat(16)}`;
  const name = `${SURVEY}/${ID}`;
  const properties = { contentType: "image/png", contentLength: 1234 };
  const metadata = {
    kind: "asset",
    name: encodeURIComponent('Логотип "ü" 1.png'),
    createdat: "2026-09-01T10:00:05.123Z",
  };

  it("reads the record from the name, the properties and the metadata, decoding the name", () => {
    expect(fileRecordFromBlob(name, properties, metadata)).toEqual({
      id: ID,
      surveyId: SURVEY,
      kind: "asset",
      name: 'Логотип "ü" 1.png',
      contentType: "image/png",
      size: 1234,
      createdAt: "2026-09-01T10:00:05.123Z",
    });
  });

  it("ignores names outside {surveyId}/{64 hex digits} and a survey part that is not the id's", () => {
    const other = "22222222-0000-4000-8000-a00000000002";
    for (const blob of [
      ID,
      `${other}/${ID}`,
      `${SURVEY}/${ID}/extra`,
      `${SURVEY}/${ID.slice(1)}`,
      `${SURVEY}/${ID}0`,
      `${SURVEY}/${ID.toUpperCase()}`,
      `${SURVEY.toUpperCase()}/${ID}`,
      `${SURVEY}/${"g".repeat(64)}`,
      `${SURVEY}/`,
      `${SURVEY}${ID}`,
      "",
    ]) {
      expect(fileRecordFromBlob(blob, properties, metadata), blob).toBeNull();
    }
  });

  it("keeps the kind of a respondent file", () => {
    expect(fileRecordFromBlob(name, properties, { ...metadata, kind: "response" })).toMatchObject({
      id: ID,
      kind: "response",
    });
  });

  it("ignores a blob of an unknown or missing kind", () => {
    for (const kind of ["", "other", "Asset", "Response", undefined]) {
      expect(fileRecordFromBlob(name, properties, { ...metadata, kind }), String(kind)).toBeNull();
    }
    expect(fileRecordFromBlob(name, properties, undefined)).toBeNull();
  });

  it("ignores a blob without a content type or length", () => {
    expect(fileRecordFromBlob(name, { contentLength: 1234 }, metadata)).toBeNull();
    expect(fileRecordFromBlob(name, { contentType: "", contentLength: 1234 }, metadata)).toBeNull();
    expect(fileRecordFromBlob(name, { contentType: "image/png" }, metadata)).toBeNull();
  });

  it("names a file without a readable name by its id", () => {
    for (const value of [undefined, "", "%E0%A4%A"]) {
      expect(fileRecordFromBlob(name, properties, { ...metadata, name: value })?.name).toBe(ID);
    }
  });

  it("dates a file without an ISO 8601 UTC createdat at the epoch", () => {
    for (const createdat of [undefined, "", "yesterday", "2026-09-01T10:00:05+02:00"]) {
      expect(fileRecordFromBlob(name, properties, { ...metadata, createdat })?.createdAt).toBe(
        "1970-01-01T00:00:00.000Z",
      );
    }
  });
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

  it("refuses a result that is not a JSON object, naming the row id", () => {
    for (const result of ["not json", "[1]", "null"]) {
      let error: unknown;
      try {
        responseFromLegacy(entity({ result }));
      } catch (caught) {
        error = caught;
      }
      expect(error, result).toBeInstanceOf(UnmappableLegacyRowError);
      expect((error as UnmappableLegacyRowError).ids, result).toEqual({
        responseId: "dddddddd-0000-4000-8000-000000000001",
      });
    }
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

describe("privateQuestionsFromLegacy", () => {
  it("reads the fixture text", () => {
    expect(
      privateQuestionsFromLegacy(
        '[{"name":"satisfaction","isPublic":true},{"name":"receipt","isPublic":false}]',
      ),
    ).toEqual(["receipt"]);
  });

  it("keeps the first occurrence of each name that is exactly private, in order", () => {
    const text =
      '[{"name":"a"},{"name":"b","isPublic":false},{"name":"c","isPublic":true},{"isPublic":false},{"name":"","isPublic":false},"x",{"name":"b","isPublic":false},{"name":"d","isPublic":"false"}]';
    expect(privateQuestionsFromLegacy(text)).toEqual(["b"]);
  });

  it("strips one leading byte-order mark", () => {
    expect(privateQuestionsFromLegacy('﻿[{"name":"q","isPublic":false}]')).toEqual(["q"]);
  });

  it("reads an empty array as no private question", () => {
    expect(privateQuestionsFromLegacy("[]")).toEqual([]);
  });

  it.each(["{}", '"x"', "not json", ""])("answers null for %j", (text) => {
    expect(privateQuestionsFromLegacy(text)).toBeNull();
  });
});

describe("privateQuestionsToLegacy", () => {
  it("writes each name as a private element, in order", () => {
    expect(privateQuestionsToLegacy(["q2", "q1"])).toBe(
      '[{"name":"q2","isPublic":false},{"name":"q1","isPublic":false}]',
    );
    expect(privateQuestionsToLegacy([])).toBe("[]");
  });
});
