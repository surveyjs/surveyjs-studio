import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NewSurvey, SurveyOwner, SurveyRecord } from "../../domain/types.js";
import { surveyListOrder } from "../ordering.js";
import type { ProviderSet, SurveyPosition } from "../types.js";
import {
  ADMIN_ID,
  BLOCKED_ID,
  MEMBER_ID,
  OUTSIDER_ID,
  OWNER_ID,
  PROJECT_A_ID,
  PROJECT_B_ID,
  adminProjects,
  fixtureDefinitions,
  fixtureSurveys,
  fixtureUsers,
  memberProjects,
  outsiderSurveys,
  ownerPersonalActiveSurveys,
  ownerPersonalArchivedSurveys,
  ownerPersonalSurveys,
  ownerProjects,
  ownerUser,
  projectA,
  projectAActiveSurveys,
  projectAArchivedSurveys,
  projectASurveys,
  projectBSurveys,
  surveyApiCreated,
  surveyDraft,
  surveyFeedback,
  surveysWithoutDefinition,
} from "./expected.js";

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

/** The list position of a survey. */
const positionOf = (survey: SurveyRecord): SurveyPosition => ({
  updatedAt: survey.updatedAt,
  id: survey.id,
});

/**
 * A personal scope nobody uses. Tests that create surveys work in a fresh scope each, because
 * the Azurite replica keeps rows for the whole run.
 */
type PersonalScope = Extract<SurveyOwner, { kind: "personal" }>;
const freshScope = (): PersonalScope => ({ kind: "personal", userId: randomUUID() });

/**
 * A new survey in a personal scope. Times are whole seconds: SQL `datetime` keeps them exactly,
 * so the stored record equals the input.
 */
const newSurvey = (owner: PersonalScope, over: Partial<NewSurvey> = {}): NewSurvey => ({
  id: randomUUID(),
  name: "Suite survey",
  owner,
  creatorId: owner.userId,
  postId: randomUUID(),
  resultId: randomUUID(),
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

/** The record `createSurvey` must return for a personal `survey`: legacy defaults, lower-case ids. */
const storedRecord = (survey: NewSurvey): SurveyRecord => ({
  id: survey.id.toLowerCase(),
  name: survey.name,
  owner:
    survey.owner.kind === "personal"
      ? { kind: "personal", userId: survey.owner.userId.toLowerCase() }
      : { kind: "project", projectId: survey.owner.projectId.toLowerCase() },
  creatorId: survey.creatorId.toLowerCase(),
  postId: survey.postId.toLowerCase(),
  resultId: survey.resultId.toLowerCase(),
  published: false,
  archived: false,
  createdAt: survey.createdAt,
  updatedAt: survey.updatedAt,
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
});

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

    describe("surveys.listSurveyPage", () => {
      const owner = { kind: "personal", userId: OWNER_ID } as const;
      const projectAScope = { kind: "project", projectId: PROJECT_A_ID } as const;

      it("cuts the owner's active surveys into pages, with the position of the last item", async () => {
        const first = await providers.surveys.listSurveyPage({ owner, archived: false, limit: 2 });
        expect(first).toEqual({
          items: [surveyApiCreated, surveyFeedback],
          next: positionOf(surveyFeedback),
        });
        const second = await providers.surveys.listSurveyPage({
          owner,
          archived: false,
          limit: 2,
          after: positionOf(surveyFeedback),
        });
        expect(second).toEqual({ items: [surveyDraft], next: null });
      });

      it.each([
        ["the owner's archived surveys", owner, true, ownerPersonalArchivedSurveys],
        ["project A's active surveys", projectAScope, false, projectAActiveSurveys],
        ["project A's archived surveys", projectAScope, true, projectAArchivedSurveys],
      ] as const)("lists %s", async (_name, scope, archived, expected) => {
        expect(
          await providers.surveys.listSurveyPage({ owner: scope, archived, limit: 50 }),
        ).toEqual({ items: expected, next: null });
      });

      it.each([
        ["the owner's personal scope", owner],
        ["project A", projectAScope],
        ["project B", { kind: "project", projectId: PROJECT_B_ID }],
        ["the outsider's personal scope", { kind: "personal", userId: OUTSIDER_ID }],
      ] as const)(
        "with limit 200 equals listSurveys of %s split by archived",
        async (_name, scope) => {
          const all = await providers.surveys.listSurveys(scope);
          for (const archived of [false, true]) {
            expect(
              await providers.surveys.listSurveyPage({ owner: scope, archived, limit: 200 }),
            ).toEqual({ items: all.filter((s) => s.archived === archived), next: null });
          }
        },
      );

      it("gives an empty last page for an unknown owner", async () => {
        for (const scope of [
          { kind: "personal", userId: UNKNOWN_ID },
          { kind: "project", projectId: UNKNOWN_ID },
          { kind: "personal", userId: "not-a-guid" },
        ] as const) {
          expect(
            await providers.surveys.listSurveyPage({ owner: scope, archived: false, limit: 50 }),
          ).toEqual({ items: [], next: null });
        }
      });

      it("matches the owner id case-insensitively", async () => {
        expect(
          await providers.surveys.listSurveyPage({
            owner: { kind: "personal", userId: OWNER_ID.toUpperCase() },
            archived: false,
            limit: 50,
          }),
        ).toEqual({ items: ownerPersonalActiveSurveys, next: null });
      });
    });

    describe("surveys.createSurvey", () => {
      it("stores the survey with the legacy defaults and lower-case ids", async () => {
        const scope = { kind: "personal", userId: randomUUID().toUpperCase() } as const;
        const survey = newSurvey(scope, {
          id: randomUUID().toUpperCase(),
          postId: randomUUID().toUpperCase(),
          resultId: randomUUID().toUpperCase(),
        });
        expect(await providers.surveys.createSurvey(survey)).toEqual(storedRecord(survey));
      });

      it("returns the same record from getSurvey, listSurveys and listSurveyPage", async () => {
        const scope = freshScope();
        const created = await providers.surveys.createSurvey(newSurvey(scope));
        expect(await providers.surveys.getSurvey(created.id)).toEqual(created);
        expect(await providers.surveys.listSurveys(scope)).toEqual([created]);
        expect(
          await providers.surveys.listSurveyPage({ owner: scope, archived: false, limit: 50 }),
        ).toEqual({ items: [created], next: null });
      });

      it("rejects a duplicate id and keeps the first survey", async () => {
        const first = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const other = freshScope();
        await expect(
          providers.surveys.createSurvey(newSurvey(other, { id: first.id })),
        ).rejects.toThrow();
        expect(await providers.surveys.getSurvey(first.id)).toEqual(first);
        expect(await providers.surveys.listSurveys(other)).toEqual([]);
      });
    });

    describe("survey list order and paging over new surveys", () => {
      it("orders surveys updated at the same time by id", async () => {
        const scope = freshScope();
        const created = [
          await providers.surveys.createSurvey(newSurvey(scope)),
          await providers.surveys.createSurvey(newSurvey(scope)),
        ];
        const [first, second] = [...created].sort((a, b) => (a.id < b.id ? -1 : 1));
        expect(await providers.surveys.listSurveys(scope)).toEqual([first, second]);
        expect(
          await providers.surveys.listSurveyPage({ owner: scope, archived: false, limit: 1 }),
        ).toEqual({ items: [first], next: positionOf(first!) });
      });

      it("walks a list one by one without gaps or repeats while a newer survey is added", async () => {
        const scope = freshScope();
        const at = (updatedAt: string) => newSurvey(scope, { createdAt: updatedAt, updatedAt });
        const existing: SurveyRecord[] = [];
        for (const time of [
          "2026-08-03T10:00:00.000Z",
          "2026-08-02T10:00:00.000Z",
          "2026-08-02T10:00:00.000Z", // the same time: the id decides
          "2026-08-01T10:00:00.000Z",
        ]) {
          existing.push(await providers.surveys.createSurvey(at(time)));
        }
        existing.sort(surveyListOrder);

        const walked: SurveyRecord[] = [];
        let after: SurveyPosition | undefined;
        // Bounded, so a provider that loops fails instead of hanging.
        for (let page = 0; page <= existing.length; page++) {
          const result = await providers.surveys.listSurveyPage({
            owner: scope,
            archived: false,
            limit: 1,
            ...(after ? { after } : {}),
          });
          walked.push(...result.items);
          if (page === 0) await providers.surveys.createSurvey(at("2026-08-04T10:00:00.000Z"));
          if (result.next === null) break;
          after = result.next;
        }
        expect(walked).toEqual(existing);
      });
    });

    describe("surveys.getDefinition", () => {
      it.each(
        fixtureDefinitions.map(
          ([survey, definition]) => [survey.name, survey, definition] as const,
        ),
      )("returns the stored definition of %s", async (_name, survey, definition) => {
        expect(await providers.surveys.getDefinition(survey.id)).toEqual(definition);
      });

      it.each(surveysWithoutDefinition.map((survey) => [survey.name, survey] as const))(
        "returns {} for %s, which has none",
        async (_name, survey) => {
          expect(await providers.surveys.getDefinition(survey.id)).toEqual({});
        },
      );

      it("returns null for an unknown id", async () => {
        expect(await providers.surveys.getDefinition(UNKNOWN_ID)).toBeNull();
      });

      it("matches ids case-insensitively", async () => {
        const [survey, definition] = fixtureDefinitions[0]!;
        expect(await providers.surveys.getDefinition(survey.id.toUpperCase())).toEqual(definition);
      });

      it("returns the definition a survey was created with, or {} without one", async () => {
        const definition = {
          title: "Created in the suite",
          pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Ünïcode ✓" }] }],
        };
        const withDefinition = await providers.surveys.createSurvey(
          newSurvey(freshScope()),
          definition,
        );
        const without = await providers.surveys.createSurvey(newSurvey(freshScope()));
        expect(await providers.surveys.getDefinition(withDefinition.id)).toEqual(definition);
        expect(await providers.surveys.getDefinition(without.id)).toEqual({});
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

    describe("directory.getUserProject", () => {
      it("returns the user's membership with the full project record", async () => {
        expect(await providers.directory.getUserProject(OWNER_ID, PROJECT_A_ID)).toEqual({
          project: projectA,
          role: "admin",
        });
      });

      it("returns null when the user is not a member", async () => {
        expect(await providers.directory.getUserProject(MEMBER_ID, PROJECT_B_ID)).toBeNull();
        expect(await providers.directory.getUserProject(OUTSIDER_ID, PROJECT_A_ID)).toBeNull();
      });

      it("returns null for an unknown project or user, or a non-GUID id", async () => {
        expect(await providers.directory.getUserProject(OWNER_ID, UNKNOWN_ID)).toBeNull();
        expect(await providers.directory.getUserProject(UNKNOWN_ID, PROJECT_A_ID)).toBeNull();
        expect(await providers.directory.getUserProject(OWNER_ID, "personal")).toBeNull();
      });

      it("matches ids case-insensitively", async () => {
        expect(
          await providers.directory.getUserProject(
            OWNER_ID.toUpperCase(),
            PROJECT_A_ID.toUpperCase(),
          ),
        ).toEqual({ project: projectA, role: "admin" });
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
