import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SurveyRecord } from "../domain/types.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import {
  MEMBER_ID,
  OWNER_ID,
  PROJECT_B_ID,
  memberProjects,
  ownerPersonalSurveys,
} from "./suite/expected.js";
import type { ProviderSet } from "./types.js";

// Runs in the `providers-azurite` Vitest project. Adds rows with NULL columns to the replica,
// then restores the golden fixtures so other files see the usual data in any order.

const NULL_NAME_SURVEY = "eeeeeeee-0000-4000-8000-0000000000a1";
const NULL_POSTID_SURVEY = "eeeeeeee-0000-4000-8000-0000000000a2";
const NULL_ROLE_MEMBERSHIP = "eeeeeeee-0000-4000-8000-0000000000b1";
const NULL_EMAIL_USER = "eeeeeeee-0000-4000-8000-0000000000e1";
const OLDEST = "2020-01-01T00:00:00.000Z";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Warning {
  details: Readonly<Record<string, string>>;
  message: string;
}

async function insertRows(connectionString: string): Promise<void> {
  const pool = await new sql.ConnectionPool(connectionString).connect();
  try {
    const survey = (id: string, postId: string | null) =>
      pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .input("userid", sql.UniqueIdentifier, OWNER_ID)
        .input("postid", sql.UniqueIdentifier, postId)
        .input("resultid", sql.UniqueIdentifier, "eeeeeeee-0000-4000-8000-0000000000c1")
        .input("timestamp", sql.DateTime, new Date(OLDEST))
        .query(
          "INSERT INTO Surveys (id, name, userid, creatorid, postid, resultid, createdat, [timestamp]) " +
            "VALUES (@id, NULL, @userid, NULL, @postid, @resultid, NULL, @timestamp)",
        );
    await survey(NULL_NAME_SURVEY, "eeeeeeee-0000-4000-8000-0000000000d1");
    await survey(NULL_POSTID_SURVEY, null);
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, NULL_ROLE_MEMBERSHIP)
      .input("organizationid", sql.UniqueIdentifier, PROJECT_B_ID)
      .input("userid", sql.UniqueIdentifier, MEMBER_ID)
      .query(
        "INSERT INTO OrganizationUsers (id, organizationid, userid, role, type) " +
          "VALUES (@id, @organizationid, @userid, NULL, 'ORGANIZATION_JOIN')",
      );
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, NULL_EMAIL_USER)
      .query("INSERT INTO Users (id, email, displayname, blocked) VALUES (@id, NULL, NULL, NULL)");
  } finally {
    await pool.close();
  }
}

describe("azure-legacy provider with NULL legacy columns (local replica)", () => {
  const warnings: Warning[] = [];
  let providers: ProviderSet | undefined;

  beforeAll(async () => {
    const config = replicaConfig();
    await insertRows(config.sqlConnectionString);
    providers = createAzureLegacyProviders(config, {
      logger: { warn: (details, message) => warnings.push({ details, message }) },
    });
  });

  // Runs even when beforeAll failed half way, so no stray rows are left for other files.
  afterAll(async () => {
    try {
      await providers?.close();
    } finally {
      await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
    }
  });

  /** Set by beforeAll; a failed beforeAll skips the tests. */
  const store = (): ProviderSet => {
    if (!providers) throw new Error("beforeAll did not create the providers");
    return providers;
  };

  it('maps a NULL email to "" and never finds that user by a blank email', async () => {
    expect(await store().directory.getUser(NULL_EMAIL_USER)).toEqual({
      id: NULL_EMAIL_USER,
      email: "",
      displayName: "",
      blocked: false,
    });
    expect(await store().directory.findUserByEmail("")).toBeNull();
    expect(await store().directory.findUserByEmail(" ")).toBeNull();
  });

  it("lists a survey with NULL name, creatorid and createdat using the defaults", async () => {
    const expected: SurveyRecord = {
      id: NULL_NAME_SURVEY,
      name: "",
      owner: { kind: "personal", userId: OWNER_ID },
      creatorId: null,
      postId: "eeeeeeee-0000-4000-8000-0000000000d1",
      resultId: "eeeeeeee-0000-4000-8000-0000000000c1",
      published: false,
      archived: false,
      createdAt: OLDEST,
      updatedAt: OLDEST,
      settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
    };
    warnings.length = 0;
    const list = await store().surveys.listSurveys({ kind: "personal", userId: OWNER_ID });
    expect(list).toEqual([...ownerPersonalSurveys, expected]);
    expect(await store().surveys.getSurvey(NULL_NAME_SURVEY)).toEqual(expected);
    expect(warnings).toEqual([
      { details: { surveyId: NULL_POSTID_SURVEY }, message: expect.any(String) as string },
    ]);
  });

  it("skips a survey with a NULL postid: getSurvey gives null and a warning", async () => {
    warnings.length = 0;
    expect(await store().surveys.getSurvey(NULL_POSTID_SURVEY)).toBeNull();
    expect(warnings.map((w) => w.details)).toEqual([{ surveyId: NULL_POSTID_SURVEY }]);
  });

  it("skips a membership with a NULL role and reports its ids", async () => {
    warnings.length = 0;
    expect(await store().directory.listUserProjects(MEMBER_ID)).toEqual(memberProjects);
    expect(warnings.map((w) => w.details)).toEqual([
      { membershipId: NULL_ROLE_MEMBERSHIP, organizationId: PROJECT_B_ID },
    ]);
  });

  it("reports only row ids: every detail is a GUID and messages hold no names or emails", async () => {
    warnings.length = 0;
    await store().surveys.listSurveys({ kind: "personal", userId: OWNER_ID });
    await store().surveys.getSurvey(NULL_POSTID_SURVEY);
    await store().directory.listUserProjects(MEMBER_ID);
    expect(warnings).toHaveLength(3);
    for (const { details, message } of warnings) {
      for (const value of Object.values(details)) expect(value).toMatch(GUID);
      expect(message).not.toMatch(/@|Engineering|Marketing|Password|AccountKey/);
    }
  });
});
