import { randomUUID } from "node:crypto";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEraseAccount, previewErasure } from "../accounts/erasure.js";
import { findErasureCandidates } from "../accounts/reconcile.js";
import type { SurveyRecord } from "../domain/types.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { localBlobServiceClient } from "../legacy/local-clients.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import {
  ADMIN_ID,
  BLOCKED_ID,
  ERASABLE_ID,
  LICENCE_CLOCK,
  MEMBER_ID,
  OWNER_ID,
  PROJECT_B_ID,
  fixtureProjectsOnly,
  memberProjects,
  ownerPersonalActiveSurveys,
  ownerPersonalSurveys,
} from "./suite/expected.js";
import type { ProviderSet } from "./types.js";

// Runs in the `providers-azurite` Vitest project. Adds rows with NULL columns to the replica,
// then restores the golden fixtures so other files see the usual data in any order.

const NULL_NAME_SURVEY = "eeeeeeee-0000-4000-8000-0000000000a1";
// Sorts before NULL_NAME_SURVEY (same time, smaller id), so a page can end on this skipped row.
const NULL_POSTID_SURVEY = "eeeeeeee-0000-4000-8000-0000000000a0";
const NULL_ROLE_MEMBERSHIP = "eeeeeeee-0000-4000-8000-0000000000b1";
const NULL_EMAIL_USER = "eeeeeeee-0000-4000-8000-0000000000e1";
const EXPIRED_LICENCE = "eeeeeeee-0000-4000-8000-0000000000f1";
const ORPHAN_SEAT = "eeeeeeee-0000-4000-8000-0000000000f2";
const OLDEST = "2020-01-01T00:00:00.000Z";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NOW = "2026-10-19T10:00:00.000Z";
const NO_COUNTS = { surveysDeleted: 0, projectsLeft: 0, projectsDeleted: 0, adminsPromoted: 0 };

/** Runs `use` with a pool of the replica's database, closed afterwards. */
async function onReplica<T>(use: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = await new sql.ConnectionPool(replicaConfig().sqlConnectionString).connect();
  try {
    return await use(pool);
  } finally {
    await pool.close();
  }
}

/** An archived `Surveys` row; a NULL `postid` or `resultid` makes it a row the mapping skips. */
const insertSurvey = (
  pool: sql.ConnectionPool,
  row: { id: string; userid: string; postid: string | null; resultid: string | null },
) =>
  pool
    .request()
    .input("id", sql.UniqueIdentifier, row.id)
    .input("userid", sql.UniqueIdentifier, row.userid)
    .input("postid", sql.UniqueIdentifier, row.postid)
    .input("resultid", sql.UniqueIdentifier, row.resultid)
    .input("timestamp", sql.DateTime, new Date(OLDEST))
    .query(
      "INSERT INTO Surveys (id, name, userid, postid, resultid, isarchived, [timestamp]) " +
        "VALUES (@id, 'Unmappable', @userid, @postid, @resultid, 1, @timestamp)",
    );

const insertProject = (pool: sql.ConnectionPool, id: string) =>
  pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .query(
      "INSERT INTO Organizations (id, name, type) VALUES (@id, 'Unmappable', 'ORGANIZATION_CREATE')",
    );

const insertMember = (
  pool: sql.ConnectionPool,
  projectId: string,
  userId: string,
  role: string | null,
) =>
  pool
    .request()
    .input("id", sql.UniqueIdentifier, randomUUID())
    .input("project", sql.UniqueIdentifier, projectId)
    .input("user", sql.UniqueIdentifier, userId)
    .input("role", sql.VarChar(sql.MAX), role)
    .query(
      "INSERT INTO OrganizationUsers (id, organizationid, userid, role, type) " +
        "VALUES (@id, @project, @user, @role, 'ORGANIZATION_JOIN')",
    );

/** How many rows `text` counts, with `@id` bound to `id`. */
const countRows = (text: string, id: string): Promise<number> =>
  onReplica(async (pool) => {
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query<{ n: number }>(text);
    return result.recordset[0]!.n;
  });
const surveyRows = (id: string) =>
  countRows("SELECT COUNT(*) AS n FROM Surveys WHERE id = @id", id);
const memberRows = (userId: string) =>
  countRows("SELECT COUNT(*) AS n FROM OrganizationUsers WHERE userid = @id", userId);
const projectRows = (id: string) =>
  countRows("SELECT COUNT(*) AS n FROM Organizations WHERE id = @id", id);

interface Warning {
  details: Readonly<Record<string, string>>;
  message: string;
}

/** A `surveyjson` blob whose text is not JSON, for the NULL-name survey. */
async function writeBrokenDefinition(connectionString: string): Promise<void> {
  const blob = localBlobServiceClient(connectionString, "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING")
    .getContainerClient("surveyjson")
    .getAppendBlobClient(NULL_NAME_SURVEY);
  const text = Buffer.from('{"title": "Cut off', "utf8");
  await blob.create();
  await blob.appendBlock(text, text.length);
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
    // The blocked user gets an expired licence and a developer seat whose parent row is missing.
    const licence = (id: string, parent: string | null) =>
      pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .input("userid", sql.UniqueIdentifier, BLOCKED_ID)
        .input("parent", sql.UniqueIdentifier, parent)
        .input("expires", sql.DateTime, new Date(OLDEST))
        .query(
          "INSERT INTO UserLicenses (id, userid, parentlicenseid, expirationdate) " +
            "VALUES (@id, @userid, @parent, @expires)",
        );
    await licence(EXPIRED_LICENCE, null);
    await licence(ORPHAN_SEAT, "eeeeeeee-0000-4000-8000-0000000000f9");
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
    await writeBrokenDefinition(config.surveysStorageConnectionString);
    providers = createAzureLegacyProviders(config, {
      logger: { warn: (details, message) => warnings.push({ details, message }) },
      accountNotices: "surveyjs-licenses",
      now: () => LICENCE_CLOCK,
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
    expect(await store().users.getUser(NULL_EMAIL_USER)).toEqual({
      id: NULL_EMAIL_USER,
      email: "",
      displayName: "",
      blocked: false,
    });
    expect(await store().users.findUserByEmail("")).toBeNull();
    expect(await store().users.findUserByEmail(" ")).toBeNull();
  });

  it("lists a survey with NULL name, creatorid, createdat and ispublished using the defaults", async () => {
    const expected: SurveyRecord = {
      id: NULL_NAME_SURVEY,
      name: "",
      owner: { kind: "personal", userId: OWNER_ID },
      creatorId: null,
      postId: "eeeeeeee-0000-4000-8000-0000000000d1",
      resultId: "eeeeeeee-0000-4000-8000-0000000000c1",
      // An empty published flag means published (ADR 0014 S1).
      published: true,
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

  it("pages past a skipped row: a shorter page that still points at the rest", async () => {
    const owner = { kind: "personal", userId: OWNER_ID } as const;
    warnings.length = 0;
    // The fourth row of the active list is the skipped one; a fifth row follows it.
    const first = await store().surveys.listSurveyPage({ owner, archived: false, limit: 4 });
    expect(first).toEqual({
      items: ownerPersonalActiveSurveys,
      next: { updatedAt: OLDEST, id: NULL_POSTID_SURVEY },
    });
    const second = await store().surveys.listSurveyPage({
      owner,
      archived: false,
      limit: 4,
      after: first.next!,
    });
    expect(second.items.map((survey) => survey.id)).toEqual([NULL_NAME_SURVEY]);
    expect(second.next).toBeNull();
    expect(warnings.map((w) => w.details)).toEqual([{ surveyId: NULL_POSTID_SURVEY }]);
  });

  it("skips a survey with a NULL postid: getSurvey gives null and a warning", async () => {
    warnings.length = 0;
    expect(await store().surveys.getSurvey(NULL_POSTID_SURVEY)).toBeNull();
    expect(warnings.map((w) => w.details)).toEqual([{ surveyId: NULL_POSTID_SURVEY }]);
  });

  it("reads a definition blob that is not JSON as {} and warns with the survey id only", async () => {
    warnings.length = 0;
    expect((await store().surveys.getDefinition(NULL_NAME_SURVEY))?.content).toEqual({});
    expect(warnings).toEqual([
      { details: { surveyId: NULL_NAME_SURVEY }, message: expect.any(String) as string },
    ]);
    expect(warnings[0]!.message).not.toContain("Cut off");
  });

  it("skips a membership with a NULL role and reports its ids", async () => {
    warnings.length = 0;
    expect(fixtureProjectsOnly(await store().projects.listUserProjects(MEMBER_ID))).toEqual(
      memberProjects,
    );
    expect(warnings.map((w) => w.details)).toEqual([
      { membershipId: NULL_ROLE_MEMBERSHIP, organizationId: PROJECT_B_ID },
    ]);
  });

  it("gives no licence notice when a developer seat's parent licence is missing, and warns", async () => {
    // The legacy site fails the whole check on such a seat, so even the expired licence shows nothing.
    warnings.length = 0;
    expect(await store().notices.noticesFor(BLOCKED_ID)).toEqual([]);
    expect(warnings).toEqual([
      { details: { licenceId: ORPHAN_SEAT }, message: expect.any(String) as string },
    ]);
  });

  it("reports only row ids: every detail is a GUID and messages hold no names or emails", async () => {
    warnings.length = 0;
    await store().surveys.listSurveys({ kind: "personal", userId: OWNER_ID });
    await store().surveys.getSurvey(NULL_POSTID_SURVEY);
    await store().projects.listUserProjects(MEMBER_ID);
    expect(warnings).toHaveLength(3);
    for (const { details, message } of warnings) {
      for (const value of Object.values(details)) expect(value).toMatch(GUID);
      expect(message).not.toMatch(/@|Engineering|Marketing|Password|AccountKey/);
    }
  });

  describe("erasure reaches the rows the mapping skips (R11)", () => {
    // Reconciliation reads raw ids (listPersonalOwnerIds, listMemberUserIds); erasure must leave
    // none of them, or the id is listed again on every run. Memberships are Erin's only (the
    // Users foreign key); a fresh id owns the personal surveys of the first case.
    const erase = (userId: string) => createEraseAccount(store())(userId, { now: NOW });

    it("deletes personal surveys with a NULL postid or resultid; the id is no longer a candidate", async () => {
      const owner = randomUUID();
      const bothNull = randomUUID();
      const nullResult = randomUUID();
      await onReplica(async (pool) => {
        await insertSurvey(pool, { id: bothNull, userid: owner, postid: null, resultid: null });
        await insertSurvey(pool, {
          id: nullResult,
          userid: owner,
          postid: randomUUID(),
          resultid: null,
        });
      });
      const definition = localBlobServiceClient(
        replicaConfig().surveysStorageConnectionString,
        "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
      )
        .getContainerClient("surveyjson")
        .getAppendBlobClient(bothNull);
      await definition.create();
      const personal = { kind: "personal", userId: owner } as const;
      expect(await store().surveys.listSurveys(personal)).toEqual([]);
      expect(await store().surveys.listSurveyIds(personal)).toEqual([bothNull, nullResult].sort());
      expect(await findErasureCandidates(store())).toContain(owner);
      expect((await previewErasure(store(), owner)).personalSurveys).toEqual(
        [bothNull, nullResult].sort().map((id) => ({ id, name: "" })),
      );

      expect(await erase(owner)).toEqual({ userId: owner, ...NO_COUNTS, surveysDeleted: 2 });

      expect(await surveyRows(bothNull)).toBe(0);
      expect(await surveyRows(nullResult)).toBe(0);
      expect(await definition.exists()).toBe(false);
      expect(await store().surveys.listPersonalOwnerIds()).not.toContain(owner);
      expect(await findErasureCandidates(store())).not.toContain(owner);
      expect(await erase(owner)).toEqual({ userId: owner, ...NO_COUNTS });
    });

    it("erases Erin's NULL-role rows: a project she leaves, one she was the last member of", async () => {
      await erase(ERASABLE_ID); // leftovers of an interrupted earlier run (R4)
      const shared = randomUUID();
      const alone = randomUUID();
      const projectSurvey = randomUUID();
      const personalSurvey = randomUUID();
      await onReplica(async (pool) => {
        await insertProject(pool, shared);
        await insertMember(pool, shared, ADMIN_ID, "admin");
        await insertMember(pool, shared, ERASABLE_ID, null);
        await insertProject(pool, alone);
        await insertMember(pool, alone, ERASABLE_ID, null);
        await insertSurvey(pool, {
          id: projectSurvey,
          userid: alone,
          postid: null,
          resultid: null,
        });
        await insertSurvey(pool, {
          id: personalSurvey,
          userid: ERASABLE_ID,
          postid: randomUUID(),
          resultid: null,
        });
      });
      expect(await store().projects.listUserProjects(ERASABLE_ID)).toEqual([]);
      expect(await store().projects.listUserProjectIds(ERASABLE_ID)).toEqual(
        [shared, alone].sort(),
      );
      expect(await store().projects.listMemberUserIds()).toContain(ERASABLE_ID);
      const preview = await previewErasure(store(), ERASABLE_ID);
      expect(preview.personalSurveys).toEqual([{ id: personalSurvey, name: "" }]);
      expect(preview.projects).toEqual(
        expect.arrayContaining([
          { id: shared, name: "", decision: { kind: "remove" }, surveyCount: 0 },
          { id: alone, name: "", decision: { kind: "last-member" }, surveyCount: 1 },
        ]),
      );

      expect(await erase(ERASABLE_ID)).toEqual({
        userId: ERASABLE_ID,
        surveysDeleted: 2,
        projectsLeft: 1,
        projectsDeleted: 1,
        adminsPromoted: 0,
      });

      expect(await memberRows(ERASABLE_ID)).toBe(0);
      expect(await projectRows(shared)).toBe(1);
      expect(await projectRows(alone)).toBe(0);
      expect(await surveyRows(projectSurvey)).toBe(0);
      expect(await surveyRows(personalSurvey)).toBe(0);
      expect(await store().projects.listMemberUserIds()).not.toContain(ERASABLE_ID);
      expect(await store().surveys.listPersonalOwnerIds()).not.toContain(ERASABLE_ID);
      expect(await erase(ERASABLE_ID)).toEqual({ userId: ERASABLE_ID, ...NO_COUNTS });
    });

    it("deletes Erin's row of an organization whose row is gone and answers remove", async () => {
      // The replica's foreign key forbids such a row, so it is switched off for this one insert
      // (afterAll reloads the schema with it). Production rows may predate the key.
      await erase(ERASABLE_ID); // leftovers of an interrupted earlier run (R4)
      const gone = randomUUID();
      await onReplica(async (pool) => {
        const alter = (check: "CHECK" | "NOCHECK") =>
          pool
            .request()
            .batch(
              `ALTER TABLE OrganizationUsers ${check} CONSTRAINT organizationusers_organization_fk`,
            );
        await alter("NOCHECK");
        try {
          await insertMember(pool, gone, ERASABLE_ID, "user");
        } finally {
          await alter("CHECK");
        }
      });
      expect(await store().projects.listUserProjectIds(ERASABLE_ID)).toEqual([gone]);
      expect(await store().projects.listMemberUserIds()).toContain(ERASABLE_ID);

      expect(await erase(ERASABLE_ID)).toEqual({
        userId: ERASABLE_ID,
        ...NO_COUNTS,
        projectsLeft: 1,
      });

      expect(await memberRows(ERASABLE_ID)).toBe(0);
      expect(await store().projects.listMemberUserIds()).not.toContain(ERASABLE_ID);
      expect(await store().projects.eraseMember(gone, ERASABLE_ID, { now: NOW })).toEqual({
        kind: "not-member",
      });
    });
  });
});
