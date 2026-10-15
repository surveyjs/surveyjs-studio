import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderSet } from "../types.js";
import {
  ADMIN_ID,
  BLOCKED_ID,
  MEMBER_ID,
  OUTSIDER_ID,
  OWNER_ID,
  PROJECT_A_ID,
  PROJECT_B_ID,
  adminProjects,
  fixtureSurveys,
  fixtureUsers,
  memberProjects,
  outsiderSurveys,
  ownerPersonalSurveys,
  ownerProjects,
  ownerUser,
  projectASurveys,
  projectBSurveys,
  surveyFeedback,
} from "./expected.js";

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

/**
 * Behaviour every provider must show against the golden legacy fixtures. `create` returns a
 * provider that holds them. Everything is checked through the ProviderSet interface.
 */
export function describeProviderSuite(name: string, create: () => Promise<ProviderSet>): void {
  describe(`provider suite: ${name}`, () => {
    let providers: ProviderSet;
    beforeAll(async () => {
      providers = await create();
    });
    afterAll(async () => {
      await providers.close();
    });

    describe("surveys.getSurvey", () => {
      it.each(fixtureSurveys.map((survey) => [survey.name, survey] as const))(
        "returns the expected record for %s",
        async (_name, survey) => {
          expect(await providers.surveys.getSurvey(survey.id)).toEqual(survey);
        },
      );

      it("returns null for an unknown id", async () => {
        expect(await providers.surveys.getSurvey(UNKNOWN_ID)).toBeNull();
      });

      it("matches ids case-insensitively and returns lower-case ids", async () => {
        const found = await providers.surveys.getSurvey(surveyFeedback.id.toUpperCase());
        expect(found).toEqual(surveyFeedback);
      });
    });

    describe("surveys.listSurveys", () => {
      it.each([
        [
          "the owner's personal scope",
          { kind: "personal", userId: OWNER_ID },
          ownerPersonalSurveys,
        ],
        ["project A", { kind: "project", projectId: PROJECT_A_ID }, projectASurveys],
        ["project B", { kind: "project", projectId: PROJECT_B_ID }, projectBSurveys],
        [
          "the outsider's personal scope",
          { kind: "personal", userId: OUTSIDER_ID },
          outsiderSurveys,
        ],
      ] as const)("lists %s, archived included, newest first", async (_name, owner, expected) => {
        expect(await providers.surveys.listSurveys(owner)).toEqual(expected);
      });

      it("lists nothing for an owner without surveys", async () => {
        expect(
          await providers.surveys.listSurveys({ kind: "personal", userId: BLOCKED_ID }),
        ).toEqual([]);
        expect(
          await providers.surveys.listSurveys({ kind: "project", projectId: UNKNOWN_ID }),
        ).toEqual([]);
      });

      it("does not mix a user scope with a project scope", async () => {
        expect(
          await providers.surveys.listSurveys({ kind: "project", projectId: OWNER_ID }),
        ).toEqual([]);
        expect(
          await providers.surveys.listSurveys({ kind: "personal", userId: PROJECT_A_ID }),
        ).toEqual([]);
      });

      it("matches ids case-insensitively and returns lower-case ids", async () => {
        const personal = await providers.surveys.listSurveys({
          kind: "personal",
          userId: OWNER_ID.toUpperCase(),
        });
        expect(personal).toEqual(ownerPersonalSurveys);
        const project = await providers.surveys.listSurveys({
          kind: "project",
          projectId: PROJECT_A_ID.toUpperCase(),
        });
        expect(project).toEqual(projectASurveys);
      });
    });

    describe("directory.getUser", () => {
      it.each(fixtureUsers.map((user) => [user.email, user] as const))(
        "returns the expected user %s",
        async (_email, user) => {
          expect(await providers.directory.getUser(user.id)).toEqual(user);
        },
      );

      it("returns null for an unknown id", async () => {
        expect(await providers.directory.getUser(UNKNOWN_ID)).toBeNull();
      });

      it("matches ids case-insensitively and returns lower-case ids", async () => {
        expect(await providers.directory.getUser(OWNER_ID.toUpperCase())).toEqual(ownerUser);
      });
    });

    describe("directory.findUserByEmail", () => {
      it("finds a user by email, ignoring case", async () => {
        expect(await providers.directory.findUserByEmail("owner@example.com")).toEqual(ownerUser);
        expect(await providers.directory.findUserByEmail("OWNER@Example.COM")).toEqual(ownerUser);
      });

      it("returns null for an unknown email", async () => {
        expect(await providers.directory.findUserByEmail("nobody@example.com")).toBeNull();
      });

      it("returns null for a blank email", async () => {
        expect(await providers.directory.findUserByEmail("")).toBeNull();
        expect(await providers.directory.findUserByEmail("  ")).toBeNull();
      });
    });

    describe("directory.listUserProjects", () => {
      it.each([
        ["the owner", OWNER_ID, ownerProjects],
        ["the admin", ADMIN_ID, adminProjects],
        ["the member", MEMBER_ID, memberProjects],
        ["the outsider", OUTSIDER_ID, []],
      ] as const)("lists the projects of %s ordered by name", async (_name, userId, expected) => {
        expect(await providers.directory.listUserProjects(userId)).toEqual(expected);
      });

      it("matches ids case-insensitively", async () => {
        expect(await providers.directory.listUserProjects(OWNER_ID.toUpperCase())).toEqual(
          ownerProjects,
        );
      });

      it("returns an empty list for an unknown user", async () => {
        expect(await providers.directory.listUserProjects(UNKNOWN_ID)).toEqual([]);
      });
    });

    describe("notices", () => {
      // ACCOUNT_NOTICES is `none` unless the factory sets it; the licence cases have their own suite.
      it.each(fixtureUsers.map((user) => [user.email, user.id] as const))(
        "gives %s no notices by default",
        async (_email, id) => {
          expect(await providers.notices.noticesFor(id)).toEqual([]);
        },
      );
    });

    describe("lifecycle", () => {
      it("ready resolves true", async () => {
        expect(await providers.ready()).toBe(true);
      });

      it("close resolves", async () => {
        const separate = await create();
        await expect(separate.close()).resolves.toBeUndefined();
      });
    });
  });
}
