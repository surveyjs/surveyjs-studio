import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newFileId, surveyIdOfFile } from "../../domain/file-id.js";
import type {
  NewResponse,
  NewSurvey,
  StoredFileRecord,
  SurveyOwner,
  SurveyRecord,
} from "../../domain/types.js";
import { surveyListOrder } from "../ordering.js";
import type { AppendOutcome, ProviderSet, ResponsePosition, SurveyPosition } from "../types.js";
import {
  ADMIN_ID,
  BLOCKED_ID,
  MEMBER_ID,
  OUTSIDER_ID,
  OWNER_ID,
  PROJECT_A_ID,
  PROJECT_B_ID,
  adminProjects,
  campaignResponses,
  feedbackHistoryIds,
  feedbackResponses,
  feedbackHistorySnapshots,
  feedbackTheme,
  fixtureDefinitions,
  fixtureSurveys,
  fixtureUsers,
  largeSurvey500,
  largeSurvey501,
  largeSurveyFirst,
  largeSurveyId,
  largeSurveyLast,
  legacyFeedbackSummaryView,
  legacyFeedbackTableView,
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
  surveyCampaign,
  surveyDraft,
  surveyFeedback,
  surveysWithoutDefinition,
} from "./expected.js";

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

/** A minimal valid 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

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
        expect((await providers.surveys.getDefinition(survey.id))?.content).toEqual(definition);
      });

      it.each(surveysWithoutDefinition.map((survey) => [survey.name, survey] as const))(
        "returns {} for %s, which has none",
        async (_name, survey) => {
          expect((await providers.surveys.getDefinition(survey.id))?.content).toEqual({});
        },
      );

      it("returns null for an unknown id", async () => {
        expect(await providers.surveys.getDefinition(UNKNOWN_ID)).toBeNull();
      });

      it("matches ids case-insensitively", async () => {
        const [survey, definition] = fixtureDefinitions[0]!;
        expect((await providers.surveys.getDefinition(survey.id.toUpperCase()))?.content).toEqual(
          definition,
        );
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
        expect((await providers.surveys.getDefinition(withDefinition.id))?.content).toEqual(
          definition,
        );
        expect((await providers.surveys.getDefinition(without.id))?.content).toEqual({});
      });
    });

    describe("surveys.getTheme", () => {
      it("returns the stored theme of fixture 01", async () => {
        expect((await providers.surveys.getTheme(surveyFeedback.id))?.content).toEqual(
          feedbackTheme,
        );
      });

      it("returns {} for a survey without a theme", async () => {
        expect((await providers.surveys.getTheme(surveyDraft.id))?.content).toEqual({});
      });

      it("returns null for an unknown id", async () => {
        expect(await providers.surveys.getTheme(UNKNOWN_ID)).toBeNull();
      });

      it("matches ids case-insensitively", async () => {
        expect(
          (await providers.surveys.getTheme(surveyFeedback.id.toUpperCase()))?.content,
        ).toEqual(feedbackTheme);
      });
    });

    describe("surveys.getDefinition and getTheme versions", () => {
      it.each(["getDefinition", "getTheme"] as const)(
        "%s returns a version without quotes, the same for two reads",
        async (method) => {
          for (const survey of [surveyFeedback, surveyDraft]) {
            const first = await providers.surveys[method](survey.id);
            const second = await providers.surveys[method](survey.id);
            expect(first?.version).toEqual(expect.any(String));
            expect(first?.version).not.toBe("");
            expect(first?.version).not.toContain('"');
            expect(second?.version).toBe(first?.version);
          }
        },
      );
    });

    describe("surveys.saveDefinition", () => {
      const savedAt = (second: number) =>
        `2026-09-01T10:00:${String(second).padStart(2, "0")}.000Z`;

      it("saves with the current version and reads back content, version and date", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "Before",
        });
        const before = (await providers.surveys.getDefinition(survey.id))!;
        const definition = { title: "After", pages: [{ name: "page1", elements: [] }] };
        const outcome = await providers.surveys.saveDefinition(survey.id, definition, {
          ifVersion: before.version,
          userId: ADMIN_ID,
          savedAt: savedAt(5),
        });
        expect(outcome.kind).toBe("saved");
        const after = (await providers.surveys.getDefinition(survey.id))!;
        expect(after.content).toEqual(definition);
        expect(after.version).not.toBe(before.version);
        expect(outcome).toEqual({ kind: "saved", version: after.version });
        expect((await providers.surveys.getSurvey(survey.id))?.updatedAt).toBe(savedAt(5));
        const entries = (await providers.surveys.listHistory({ surveyId: survey.id, limit: 10 }))
          .items;
        expect(entries[0]).toMatchObject({ at: savedAt(5), userId: ADMIN_ID });
        expect(await providers.surveys.getHistorySnapshot(survey.id, entries[0]!.id)).toEqual(
          definition,
        );
      });

      it("answers conflict for a stale version and changes nothing", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "Start",
        });
        const start = (await providers.surveys.getDefinition(survey.id))!;
        const first = await providers.surveys.saveDefinition(
          survey.id,
          { title: "First" },
          { ifVersion: start.version, userId: ADMIN_ID, savedAt: savedAt(1) },
        );
        expect(first.kind).toBe("saved");
        const read = (await providers.surveys.getDefinition(survey.id))!;
        const record = await providers.surveys.getSurvey(survey.id);
        const history = await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 });
        const stale = await providers.surveys.saveDefinition(
          survey.id,
          { title: "Second" },
          { ifVersion: start.version, userId: ADMIN_ID, savedAt: savedAt(2) },
        );
        expect(stale).toEqual({ kind: "conflict" });
        expect(await providers.surveys.getDefinition(survey.id)).toEqual(read);
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(record);
        expect(await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 })).toEqual(
          history,
        );
      });

      it("answers not-found for an unknown survey and creates nothing", async () => {
        const outcome = await providers.surveys.saveDefinition(
          UNKNOWN_ID,
          { title: "x" },
          { ifVersion: "none", userId: ADMIN_ID, savedAt: savedAt(1) },
        );
        expect(outcome).toEqual({ kind: "not-found" });
        expect(await providers.surveys.getSurvey(UNKNOWN_ID)).toBeNull();
        expect(await providers.surveys.getDefinition(UNKNOWN_ID)).toBeNull();
        expect(await providers.surveys.listHistory({ surveyId: UNKNOWN_ID, limit: 10 })).toEqual({
          items: [],
          next: null,
        });
      });

      it("saves a survey created without a definition with the version it read", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const read = (await providers.surveys.getDefinition(survey.id))!;
        expect(read.content).toEqual({});
        const outcome = await providers.surveys.saveDefinition(
          survey.id,
          { title: "First" },
          { ifVersion: read.version, userId: ADMIN_ID, savedAt: savedAt(1) },
        );
        expect(outcome.kind).toBe("saved");
        expect((await providers.surveys.getDefinition(survey.id))?.content).toEqual({
          title: "First",
        });
      });

      it("keeps the definition version when the theme is saved", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "Both",
        });
        const definition = (await providers.surveys.getDefinition(survey.id))!;
        const theme = (await providers.surveys.getTheme(survey.id))!;
        const saved = await providers.surveys.saveTheme(
          survey.id,
          { themeName: "x" },
          { ifVersion: theme.version, savedAt: savedAt(1) },
        );
        expect(saved.kind).toBe("saved");
        expect(await providers.surveys.getDefinition(survey.id)).toEqual(definition);
        const outcome = await providers.surveys.saveDefinition(
          survey.id,
          { title: "Next" },
          { ifVersion: definition.version, userId: ADMIN_ID, savedAt: savedAt(2) },
        );
        expect(outcome.kind).toBe("saved");
        expect((await providers.surveys.getTheme(survey.id))?.content).toEqual({ themeName: "x" });
      });
    });

    describe("surveys.saveTheme", () => {
      const savedAt = (second: number) =>
        `2026-09-01T11:00:${String(second).padStart(2, "0")}.000Z`;

      it("saves with the current version, moves updatedAt and adds no history entry", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "Themed",
        });
        const before = (await providers.surveys.getTheme(survey.id))!;
        const historyBefore = await providers.surveys.listHistory({
          surveyId: survey.id,
          limit: 50,
        });
        const theme = {
          themeName: "default",
          cssVariables: { "--sjs-primary-backcolor": "#123456" },
        };
        const outcome = await providers.surveys.saveTheme(survey.id, theme, {
          ifVersion: before.version,
          savedAt: savedAt(7),
        });
        expect(outcome.kind).toBe("saved");
        const after = (await providers.surveys.getTheme(survey.id))!;
        expect(after.content).toEqual(theme);
        expect(after.version).not.toBe(before.version);
        expect(outcome).toEqual({ kind: "saved", version: after.version });
        expect((await providers.surveys.getSurvey(survey.id))?.updatedAt).toBe(savedAt(7));
        expect(await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 })).toEqual(
          historyBefore,
        );
      });

      it("answers conflict for a stale version and changes nothing", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const start = (await providers.surveys.getTheme(survey.id))!;
        const first = await providers.surveys.saveTheme(
          survey.id,
          { themeName: "one" },
          { ifVersion: start.version, savedAt: savedAt(1) },
        );
        expect(first.kind).toBe("saved");
        const read = (await providers.surveys.getTheme(survey.id))!;
        const record = await providers.surveys.getSurvey(survey.id);
        const stale = await providers.surveys.saveTheme(
          survey.id,
          { themeName: "two" },
          { ifVersion: start.version, savedAt: savedAt(2) },
        );
        expect(stale).toEqual({ kind: "conflict" });
        expect(await providers.surveys.getTheme(survey.id)).toEqual(read);
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(record);
      });

      it("answers not-found for an unknown survey", async () => {
        expect(
          await providers.surveys.saveTheme(
            UNKNOWN_ID,
            { themeName: "x" },
            { ifVersion: "none", savedAt: savedAt(1) },
          ),
        ).toEqual({ kind: "not-found" });
        expect(await providers.surveys.getTheme(UNKNOWN_ID)).toBeNull();
      });

      it("keeps the theme version when the definition is saved", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "Both",
        });
        const definition = (await providers.surveys.getDefinition(survey.id))!;
        const theme = (await providers.surveys.getTheme(survey.id))!;
        await providers.surveys.saveDefinition(
          survey.id,
          { title: "Changed" },
          { ifVersion: definition.version, userId: ADMIN_ID, savedAt: savedAt(3) },
        );
        expect(await providers.surveys.getTheme(survey.id)).toEqual(theme);
      });
    });

    describe("surveys.listHistory and getHistorySnapshot", () => {
      const savedAt = (second: number) =>
        `2026-09-01T12:00:${String(second).padStart(2, "0")}.000Z`;

      /** A survey with its create entry and one entry per given time. */
      const savedSurvey = async (seconds: readonly number[]) => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "v0",
        });
        for (const second of seconds) {
          const read = (await providers.surveys.getDefinition(survey.id))!;
          const outcome = await providers.surveys.saveDefinition(
            survey.id,
            { title: `v${second}`, n: Math.random() },
            { ifVersion: read.version, userId: ADMIN_ID, savedAt: savedAt(second) },
          );
          expect(outcome.kind).toBe("saved");
        }
        return survey;
      };

      it("lists the create entry and every save, newest first", async () => {
        const survey = await savedSurvey([1, 2, 3]);
        const { items, next } = await providers.surveys.listHistory({
          surveyId: survey.id,
          limit: 50,
        });
        expect(items.map((e) => e.at)).toEqual([
          savedAt(3),
          savedAt(2),
          savedAt(1),
          survey.createdAt,
        ]);
        expect(items.map((e) => e.userId)).toEqual([
          ADMIN_ID,
          ADMIN_ID,
          ADMIN_ID,
          survey.creatorId,
        ]);
        expect(next).toBeNull();
        expect(await providers.surveys.getHistorySnapshot(survey.id, items[0]!.id)).toMatchObject({
          title: "v3",
        });
        expect(await providers.surveys.getHistorySnapshot(survey.id, items[3]!.id)).toEqual({
          title: "v0",
        });
      });

      it("pages without gaps or repeats", async () => {
        const survey = await savedSurvey([1, 2, 3]);
        const all = (await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 })).items;
        const first = await providers.surveys.listHistory({ surveyId: survey.id, limit: 2 });
        expect(first.items).toEqual(all.slice(0, 2));
        expect(first.next).toEqual({ at: all[1]!.at, id: all[1]!.id });
        const second = await providers.surveys.listHistory({
          surveyId: survey.id,
          after: first.next!,
          limit: 2,
        });
        expect(second.items).toEqual(all.slice(2));
        expect(second.next).toBeNull();
      });

      it("orders equal times by id descending", async () => {
        const survey = await savedSurvey([4, 4]);
        const { items } = await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 });
        const tied = items.filter((e) => e.at === savedAt(4)).map((e) => e.id);
        expect(tied).toHaveLength(2);
        expect(tied).toEqual([...tied].sort().reverse());
        expect(items.slice(0, 2).map((e) => e.id)).toEqual(tied);
      });

      it("accepts an upper-case survey id and gives an empty page for an unknown one", async () => {
        const survey = await savedSurvey([1]);
        const lower = await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 });
        expect(
          await providers.surveys.listHistory({ surveyId: survey.id.toUpperCase(), limit: 50 }),
        ).toEqual(lower);
        expect(await providers.surveys.listHistory({ surveyId: UNKNOWN_ID, limit: 50 })).toEqual({
          items: [],
          next: null,
        });
      });

      it("returns null for a snapshot that does not exist", async () => {
        const survey = await savedSurvey([]);
        expect(await providers.surveys.getHistorySnapshot(survey.id, UNKNOWN_ID)).toBeNull();
        expect(await providers.surveys.getHistorySnapshot(UNKNOWN_ID, UNKNOWN_ID)).toBeNull();
      });

      it("holds the two legacy points of fixture 01, without a user", async () => {
        const { items } = await providers.surveys.listHistory({
          surveyId: surveyFeedback.id,
          limit: 50,
        });
        expect(items.map((e) => e.id).sort()).toEqual([...feedbackHistoryIds]);
        expect(items.every((e) => e.userId === null)).toBe(true);
        for (const id of feedbackHistoryIds) {
          expect(await providers.surveys.getHistorySnapshot(surveyFeedback.id, id)).toEqual(
            feedbackHistorySnapshots[id],
          );
        }
      });

      it("records one entry by the creator for a create with a definition, none without", async () => {
        const created = await providers.surveys.createSurvey(newSurvey(freshScope()), {
          title: "With",
        });
        const { items } = await providers.surveys.listHistory({ surveyId: created.id, limit: 50 });
        expect(items).toEqual([
          { id: expect.any(String) as string, at: created.createdAt, userId: created.creatorId },
        ]);
        expect(await providers.surveys.getHistorySnapshot(created.id, items[0]!.id)).toEqual({
          title: "With",
        });
        const without = await providers.surveys.createSurvey(newSurvey(freshScope()));
        expect(await providers.surveys.listHistory({ surveyId: without.id, limit: 50 })).toEqual({
          items: [],
          next: null,
        });
      });

      it("records one entry for a clone of fixture 01 and leaves the source alone", async () => {
        const copy = newSurvey(freshScope(), {
          createdAt: "2026-09-02T10:00:00.000Z",
          updatedAt: "2026-09-02T10:00:00.000Z",
        });
        await providers.surveys.cloneSurvey(surveyFeedback.id, copy);
        const { items } = await providers.surveys.listHistory({ surveyId: copy.id, limit: 50 });
        expect(items).toEqual([
          { id: expect.any(String) as string, at: copy.createdAt, userId: copy.creatorId },
        ]);
        expect(await providers.surveys.getHistorySnapshot(copy.id, items[0]!.id)).toEqual(
          fixtureDefinitions[0]![1],
        );
        const source = await providers.surveys.listHistory({
          surveyId: surveyFeedback.id,
          limit: 50,
        });
        expect(source.items.map((e) => e.id).sort()).toEqual([...feedbackHistoryIds]);
      });

      it("removes the history with the survey", async () => {
        const survey = await savedSurvey([1]);
        const { items } = await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 });
        expect(await providers.surveys.deleteSurvey(survey.id)).toBe(true);
        expect(await providers.surveys.listHistory({ surveyId: survey.id, limit: 50 })).toEqual({
          items: [],
          next: null,
        });
        expect(await providers.surveys.getHistorySnapshot(survey.id, items[0]!.id)).toBeNull();
      });
    });

    describe("surveys.updateSurvey", () => {
      const UPDATED_AT = "2026-09-01T12:34:56.000Z";
      const created = (scope = freshScope()) =>
        providers.surveys.createSurvey(newSurvey(scope, { name: "Before" }));

      it.each([
        ["name", { name: "After" }, { name: "After" }],
        ["published", { published: true }, { published: true }],
        ["archived", { archived: true }, { archived: true }],
        [
          "settings.publicResults",
          { settings: { publicResults: true } },
          { settings: { publicResults: true, storeRespondentIp: false, useCookies: false } },
        ],
        [
          "settings.storeRespondentIp",
          { settings: { storeRespondentIp: true } },
          { settings: { publicResults: false, storeRespondentIp: true, useCookies: false } },
        ],
      ] as const)("changes %s alone", async (_field, changes, expected) => {
        const survey = await created();
        const updated = await providers.surveys.updateSurvey(survey.id, {
          ...changes,
          updatedAt: UPDATED_AT,
        });
        expect(updated).toEqual({ ...survey, ...expected, updatedAt: UPDATED_AT });
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(updated);
      });

      it("keeps the other setting when one setting changes", async () => {
        const survey = await created();
        await providers.surveys.updateSurvey(survey.id, {
          settings: { publicResults: true },
          updatedAt: UPDATED_AT,
        });
        const updated = await providers.surveys.updateSurvey(survey.id, {
          settings: { storeRespondentIp: true },
          updatedAt: UPDATED_AT,
        });
        expect(updated?.settings).toEqual({
          publicResults: true,
          storeRespondentIp: true,
          useCookies: false,
        });
      });

      it("takes updatedAt even when nothing else changes", async () => {
        const survey = await created();
        const updated = await providers.surveys.updateSurvey(survey.id, { updatedAt: UPDATED_AT });
        expect(updated).toEqual({ ...survey, updatedAt: UPDATED_AT });
      });

      it("matches ids case-insensitively", async () => {
        const survey = await created();
        const updated = await providers.surveys.updateSurvey(survey.id.toUpperCase(), {
          name: "Upper",
          updatedAt: UPDATED_AT,
        });
        expect(updated).toEqual({ ...survey, name: "Upper", updatedAt: UPDATED_AT });
      });

      it("moves to a project and to another Personal scope, changing owner and creator", async () => {
        const from = freshScope();
        const survey = await created(from);
        const mover = randomUUID();
        const project = { kind: "project", projectId: PROJECT_B_ID } as const;
        const toProject = await providers.surveys.updateSurvey(survey.id, {
          move: { owner: project, creatorId: mover },
          updatedAt: UPDATED_AT,
        });
        expect(toProject).toEqual({
          ...survey,
          owner: project,
          creatorId: mover,
          updatedAt: UPDATED_AT,
        });
        expect(await providers.surveys.listSurveys(from)).toEqual([]);
        expect((await providers.surveys.listSurveys(project)).map((s) => s.id)).toContain(
          survey.id,
        );

        // Back to a Personal scope, then onwards: only the new scope lists it.
        const to = freshScope();
        const toPersonal = await providers.surveys.updateSurvey(survey.id, {
          move: { owner: to, creatorId: to.userId },
          updatedAt: UPDATED_AT,
        });
        expect(toPersonal).toEqual({
          ...survey,
          owner: to,
          creatorId: to.userId,
          updatedAt: UPDATED_AT,
        });
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(toPersonal);
        expect(await providers.surveys.listSurveys(to)).toEqual([toPersonal]);
        expect((await providers.surveys.listSurveys(project)).map((s) => s.id)).not.toContain(
          survey.id,
        );
      });

      it("moves an archived survey from the active to the archived page", async () => {
        const scope = freshScope();
        const survey = await created(scope);
        const page = (archived: boolean) =>
          providers.surveys.listSurveyPage({ owner: scope, archived, limit: 50 });
        expect((await page(false)).items).toEqual([survey]);
        const updated = await providers.surveys.updateSurvey(survey.id, {
          archived: true,
          updatedAt: UPDATED_AT,
        });
        expect((await page(false)).items).toEqual([]);
        expect((await page(true)).items).toEqual([updated]);
      });

      it("returns null for an unknown id and creates nothing", async () => {
        expect(
          await providers.surveys.updateSurvey(UNKNOWN_ID, {
            name: "Ghost",
            updatedAt: UPDATED_AT,
          }),
        ).toBeNull();
        expect(await providers.surveys.getSurvey(UNKNOWN_ID)).toBeNull();
      });
    });

    describe("surveys.cloneSurvey", () => {
      const copyOf = (scope: PersonalScope, over: Partial<NewSurvey> = {}) =>
        newSurvey(scope, {
          name: "Copy of source",
          createdAt: "2026-09-02T10:00:00.000Z",
          updatedAt: "2026-09-02T10:00:00.000Z",
          ...over,
        });

      it("copies fixture 01 with its definition and theme and leaves the source alone", async () => {
        const scope = freshScope();
        const copy = copyOf(scope);
        const stored = await providers.surveys.cloneSurvey(surveyFeedback.id, copy);
        expect(stored).toEqual(storedRecord(copy));
        expect(await providers.surveys.getSurvey(copy.id)).toEqual(stored);
        expect((await providers.surveys.getDefinition(copy.id))?.content).toEqual(
          fixtureDefinitions[0]![1],
        );
        expect((await providers.surveys.getTheme(copy.id))?.content).toEqual(feedbackTheme);
        expect(await providers.surveys.listSurveys(scope)).toEqual([stored]);
        expect(await providers.surveys.getSurvey(surveyFeedback.id)).toEqual(surveyFeedback);
        expect((await providers.surveys.getDefinition(surveyFeedback.id))?.content).toEqual(
          fixtureDefinitions[0]![1],
        );
        expect((await providers.surveys.getTheme(surveyFeedback.id))?.content).toEqual(
          feedbackTheme,
        );
      });

      it("copies a survey without definition or theme as {} and {}", async () => {
        const copy = copyOf(freshScope());
        expect(await providers.surveys.cloneSurvey(surveyDraft.id, copy)).toEqual(
          storedRecord(copy),
        );
        expect((await providers.surveys.getDefinition(copy.id))?.content).toEqual({});
        expect((await providers.surveys.getTheme(copy.id))?.content).toEqual({});
      });

      it("copies the definition of a survey created with one", async () => {
        const definition = { title: "Clone me", pages: [{ name: "page1", elements: [] }] };
        const source = await providers.surveys.createSurvey(newSurvey(freshScope()), definition);
        const copy = copyOf(freshScope());
        await providers.surveys.cloneSurvey(source.id, copy);
        expect((await providers.surveys.getDefinition(copy.id))?.content).toEqual(definition);
      });

      it("returns null for an unknown source and creates no copy", async () => {
        const copy = copyOf(freshScope());
        expect(await providers.surveys.cloneSurvey(UNKNOWN_ID, copy)).toBeNull();
        expect(await providers.surveys.getSurvey(copy.id)).toBeNull();
      });

      it("rewrites the definition and theme text of the copy only, history included", async () => {
        const definition = { title: "Logo OLD-MARKER", logo: "https://x/OLD-MARKER.png" };
        const theme = { themeName: "t", cssVariables: { "--img": "url(OLD-MARKER)" } };
        const source = await providers.surveys.createSurvey(newSurvey(freshScope()), definition);
        const themeVersion = (await providers.surveys.getTheme(source.id))!.version;
        await providers.surveys.saveTheme(source.id, theme, {
          ifVersion: themeVersion,
          savedAt: "2026-08-01T11:00:00.000Z",
        });
        const sourceHistory = await providers.surveys.listHistory({
          surveyId: source.id,
          limit: 50,
        });
        const copy = copyOf(freshScope());
        const rewriteText = (text: string) => text.replaceAll("OLD-MARKER", "NEW-MARKER");
        await providers.surveys.cloneSurvey(source.id, copy, { rewriteText });

        const rewrittenDefinition = { title: "Logo NEW-MARKER", logo: "https://x/NEW-MARKER.png" };
        expect((await providers.surveys.getDefinition(copy.id))?.content).toEqual(
          rewrittenDefinition,
        );
        expect((await providers.surveys.getTheme(copy.id))?.content).toEqual({
          themeName: "t",
          cssVariables: { "--img": "url(NEW-MARKER)" },
        });
        const copyHistory = await providers.surveys.listHistory({ surveyId: copy.id, limit: 50 });
        expect(copyHistory.items).toHaveLength(1);
        expect(
          await providers.surveys.getHistorySnapshot(copy.id, copyHistory.items[0]!.id),
        ).toEqual(rewrittenDefinition);

        expect((await providers.surveys.getDefinition(source.id))?.content).toEqual(definition);
        expect((await providers.surveys.getTheme(source.id))?.content).toEqual(theme);
        expect(await providers.surveys.listHistory({ surveyId: source.id, limit: 50 })).toEqual(
          sourceHistory,
        );
      });
    });

    describe("surveys.deleteSurvey", () => {
      it("deletes a survey with its definition and theme, once", async () => {
        const scope = freshScope();
        const survey = await providers.surveys.createSurvey(newSurvey(scope), { title: "Gone" });
        const other = await providers.surveys.createSurvey(newSurvey(scope));
        expect(await providers.surveys.deleteSurvey(survey.id)).toBe(true);
        expect(await providers.surveys.getSurvey(survey.id)).toBeNull();
        expect(await providers.surveys.getDefinition(survey.id)).toBeNull();
        expect(await providers.surveys.getTheme(survey.id)).toBeNull();
        expect((await providers.surveys.listSurveys(scope)).map((s) => s.id)).toEqual([other.id]);
        expect(await providers.surveys.deleteSurvey(survey.id)).toBe(false);
        expect(await providers.surveys.getSurvey(other.id)).toEqual(other);
      });

      it("returns false for an unknown id", async () => {
        expect(await providers.surveys.deleteSurvey(UNKNOWN_ID)).toBe(false);
      });

      it("deletes a clone of fixture 01, which has a theme", async () => {
        const copy = newSurvey(freshScope());
        await providers.surveys.cloneSurvey(surveyFeedback.id, copy);
        expect(await providers.surveys.deleteSurvey(copy.id)).toBe(true);
        expect(await providers.surveys.getSurvey(copy.id)).toBeNull();
        expect(await providers.surveys.getTheme(copy.id)).toBeNull();
        expect((await providers.surveys.getTheme(surveyFeedback.id))?.content).toEqual(
          feedbackTheme,
        );
      });
    });

    describe("results", () => {
      const sid = (n: number): string =>
        `66666666-0000-4000-8000-b${n.toString(16).padStart(11, "0")}`;
      const freshSurvey = async (): Promise<SurveyRecord> =>
        providers.surveys.createSurvey(newSurvey(freshScope()));
      const append = (
        survey: SurveyRecord,
        id: string,
        over: Partial<NewResponse> = {},
      ): Promise<AppendOutcome> =>
        providers.results.appendResponse(survey, {
          id,
          submittedAt: "2026-08-02T12:00:00.000Z",
          data: { q: "first" },
          ...over,
        });
      const emptyStats = { count: 0, firstSubmittedAt: null, lastSubmittedAt: null };

      it("reads the fixture responses in order, with statistics and markers", async () => {
        expect(await providers.results.listResponses(surveyFeedback)).toStrictEqual(
          feedbackResponses,
        );
        expect(await providers.results.listResponses(surveyCampaign)).toStrictEqual(
          campaignResponses,
        );
        expect(await providers.results.stats(surveyFeedback)).toEqual({
          count: 5,
          firstSubmittedAt: "2026-04-01T08:00:00.500Z",
          lastSubmittedAt: "2026-04-01T12:00:00.000Z",
        });
        expect(await providers.results.stats(surveyCampaign)).toEqual({
          count: 5,
          firstSubmittedAt: "2026-04-02T08:00:00.500Z",
          lastSubmittedAt: "2026-04-02T12:00:00.000Z",
        });
        expect(await providers.results.listResponses(surveyDraft)).toStrictEqual([]);
        expect(await providers.results.stats(surveyDraft)).toEqual(emptyStats);
        const completion = (survey: SurveyRecord, client: string) =>
          providers.results.completion(survey, client);
        expect(await completion(surveyFeedback, "client-0001")).toBe("partial");
        expect(await completion(surveyCampaign, "client-0002")).toBe("partial");
        expect(await completion(surveyFeedback, "client-0002")).toBe("none");
        expect(await completion(surveyFeedback, "CLIENT-0001")).toBe("none");
      });

      it("stores a response on a new survey, with the id in lower case", async () => {
        const survey = await freshSurvey();
        const id = randomUUID();
        expect(await append(survey, id.toUpperCase())).toBe("stored");
        expect(await providers.results.listResponses(survey)).toStrictEqual([
          { id, submittedAt: "2026-08-02T12:00:00.000Z", data: { q: "first" }, partial: false },
        ]);
      });

      it("stores the client id and IP, and marks the client completed", async () => {
        const survey = await freshSurvey();
        const id = randomUUID();
        expect(await providers.results.completion(survey, "c-1")).toBe("none");
        expect(await append(survey, id, { clientId: "c-1", respondentIp: "203.0.113.9" })).toBe(
          "stored",
        );
        expect(await providers.results.listResponses(survey)).toStrictEqual([
          {
            id,
            submittedAt: "2026-08-02T12:00:00.000Z",
            data: { q: "first" },
            clientId: "c-1",
            respondentIp: "203.0.113.9",
            partial: false,
          },
        ]);
        expect(await providers.results.completion(survey, "c-1")).toBe("completed");
        expect(await providers.results.completion(survey, "C-1")).toBe("none");
      });

      it("keeps the first response of an id and answers exists", async () => {
        const survey = await freshSurvey();
        const other = await freshSurvey();
        const id = randomUUID();
        expect(await append(survey, id)).toBe("stored");
        expect(await append(survey, id.toUpperCase(), { data: { q: "second" } })).toBe("exists");
        expect(await append(survey, id, { data: { q: "third" } })).toBe("exists");
        expect((await providers.results.listResponses(survey)).map((r) => r.data)).toStrictEqual([
          { q: "first" },
        ]);
        expect(await providers.results.hasResponse(survey, id)).toBe(true);
        expect(await providers.results.hasResponse(survey, id.toUpperCase())).toBe(true);
        expect(await providers.results.hasResponse(survey, randomUUID())).toBe(false);
        expect(await providers.results.hasResponse(other, id)).toBe(false);
        expect(await providers.results.hasResponse(survey, "abc")).toBe(false);
      });

      it("repairs a missing marker when the same id comes again with a client id", async () => {
        const survey = await freshSurvey();
        const id = randomUUID();
        await append(survey, id);
        expect(await providers.results.completion(survey, "c-repair")).toBe("none");
        expect(await append(survey, id, { clientId: "c-repair" })).toBe("exists");
        expect(await providers.results.completion(survey, "c-repair")).toBe("completed");
        expect((await providers.results.listResponses(survey))[0]).not.toHaveProperty("clientId");
      });

      it("lists by time, then by id, and counts per survey", async () => {
        const survey = await freshSurvey();
        const other = await freshSurvey();
        const at = (hour: number) => `2026-08-02T${String(hour).padStart(2, "0")}:00:00.000Z`;
        await append(survey, sid(1), { submittedAt: at(12) });
        await append(survey, sid(2), { submittedAt: at(10) });
        await append(survey, sid(3), { submittedAt: at(14) });
        await append(survey, sid(0xb), { submittedAt: at(11) });
        await append(survey, sid(0xa), { submittedAt: at(11) });
        await append(other, sid(1), { submittedAt: at(9) });
        expect((await providers.results.listResponses(survey)).map((r) => r.id)).toStrictEqual([
          sid(2),
          sid(0xa),
          sid(0xb),
          sid(1),
          sid(3),
        ]);
        expect(await providers.results.stats(survey)).toEqual({
          count: 5,
          firstSubmittedAt: at(10),
          lastSubmittedAt: at(14),
        });
        expect(await providers.results.stats(other)).toEqual({
          count: 1,
          firstSubmittedAt: at(9),
          lastSubmittedAt: at(9),
        });
      });

      it("returns the answers unchanged", async () => {
        const survey = await freshSurvey();
        const data = {
          nested: { list: [1, "two", { three: null }], flag: true },
          text: "Ünïcødé 😀",
          markup: `& < > " '`,
        };
        await append(survey, randomUUID(), { data });
        expect((await providers.results.listResponses(survey))[0]?.data).toEqual(data);
      });

      it("rejects an id that is not a GUID and stores nothing", async () => {
        const survey = await freshSurvey();
        await expect(append(survey, "not-a-guid")).rejects.toThrow();
        expect(await providers.results.stats(survey)).toEqual(emptyStats);
      });

      it("is emptied by surveys.deleteSurvey", async () => {
        const survey = await freshSurvey();
        const id = randomUUID();
        await append(survey, id, { clientId: "c-gone" });
        expect(await providers.surveys.deleteSurvey(survey.id)).toBe(true);
        expect(await providers.results.listResponses(survey)).toStrictEqual([]);
        expect((await providers.results.stats(survey)).count).toBe(0);
        expect(await providers.results.completion(survey, "c-gone")).toBe("none");
        expect(await providers.results.hasResponse(survey, id)).toBe(false);
      });

      describe("results paging", () => {
        type Page = Awaited<ReturnType<ProviderSet["results"]["listResponsePage"]>>;

        /** Every page of a walk, following `next` as the cursor does. */
        const walk = async (survey: SurveyRecord, limit: number): Promise<Page[]> => {
          const pages: Page[] = [];
          let after: ResponsePosition | undefined;
          do {
            const page = await providers.results.listResponsePage(survey, {
              limit,
              ...(after && { after }),
            });
            pages.push(page);
            after = page.next ?? undefined;
          } while (after);
          return pages;
        };
        const ids = (pages: readonly Page[]): string[] =>
          pages.flatMap((page) => page.items.map((item) => item.id));

        it("walks the 1,500 generated responses in pages of 500", async () => {
          const pages = await walk(surveyApiCreated, 500);
          expect(pages.map((page) => page.items.length)).toEqual([500, 500, 500]);
          expect(pages.map((page) => page.next !== null)).toEqual([true, true, false]);
          expect(ids(pages)).toEqual(Array.from({ length: 1500 }, (_, i) => largeSurveyId(i + 1)));
          expect(pages[0]!.items[0]).toStrictEqual(largeSurveyFirst);
          expect(pages[0]!.items[499]).toStrictEqual(largeSurvey500);
          expect(pages[1]!.items[0]).toStrictEqual(largeSurvey501);
          expect(pages[1]!.items[0]!.submittedAt).toBe(largeSurvey500.submittedAt);
          expect(pages[2]!.items[499]).toStrictEqual(largeSurveyLast);
        });

        it("walks them in pages of 1,000 and 500", async () => {
          const pages = await walk(surveyApiCreated, 1000);
          expect(pages.map((page) => page.items.length)).toEqual([1000, 500]);
          expect(pages.map((page) => page.next !== null)).toEqual([true, false]);
          expect(pages[1]!.items[0]!.id).toBe(largeSurveyId(1001));
        });

        it("reports the statistics of the generated responses", async () => {
          expect(await providers.results.stats(surveyApiCreated)).toEqual({
            count: 1500,
            firstSubmittedAt: "2026-05-01T08:00:00.000Z",
            lastSubmittedAt: "2026-05-01T20:30:00.000Z",
          });
        });

        it("pages the five responses of fixture 01 by two", async () => {
          const pages = await walk(surveyFeedback, 2);
          expect(pages.map((page) => page.items)).toStrictEqual([
            feedbackResponses.slice(0, 2),
            feedbackResponses.slice(2, 4),
            feedbackResponses.slice(4, 5),
          ]);
          expect(pages.map((page) => page.next !== null)).toEqual([true, true, false]);
        });

        describe("on a fresh survey", () => {
          const at = (hour: number): string => `2026-08-02T${String(hour)}:00:00.000Z`;
          const seeded = async (): Promise<SurveyRecord> => {
            const survey = await freshSurvey();
            await append(survey, sid(1), { submittedAt: at(10) });
            await append(survey, sid(3), { submittedAt: at(11) });
            await append(survey, sid(2), { submittedAt: at(11) });
            await append(survey, sid(4), { submittedAt: at(12) });
            await append(survey, sid(5), { submittedAt: at(13) });
            return survey;
          };

          it("orders by time, then id, across pages of two", async () => {
            const pages = await walk(await seeded(), 2);
            expect(pages.map((page) => page.items.map((item) => item.id))).toEqual([
              [sid(1), sid(2)],
              [sid(3), sid(4)],
              [sid(5)],
            ]);
            expect(pages.map((page) => page.next !== null)).toEqual([true, true, false]);
            expect(pages[2]!.next).toBeNull();
          });

          it("gives the next position as the last item of the page", async () => {
            const first = await providers.results.listResponsePage(await seeded(), { limit: 2 });
            expect(first.next).toEqual({ submittedAt: at(11), id: sid(2) });
          });

          it("returns everything in one page with no next when the limit is the count", async () => {
            const page = await providers.results.listResponsePage(await seeded(), { limit: 5 });
            expect(page.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5].map(sid));
            expect(page.next).toBeNull();
          });

          it("returns nothing after the last position", async () => {
            const page = await providers.results.listResponsePage(await seeded(), {
              limit: 5,
              after: { submittedAt: at(13), id: sid(5) },
            });
            expect(page).toEqual({ items: [], next: null });
          });

          it("returns an empty page for a survey without responses", async () => {
            expect(
              await providers.results.listResponsePage(await freshSurvey(), { limit: 5 }),
            ).toEqual({
              items: [],
              next: null,
            });
          });
        });

        it("keeps a walk stable when responses arrive between pages", async () => {
          const survey = await freshSurvey();
          const at = (hour: number): string => `2026-08-02T${String(hour)}:00:00.000Z`;
          await append(survey, sid(1), { submittedAt: at(10) });
          await append(survey, sid(2), { submittedAt: at(11) });
          await append(survey, sid(3), { submittedAt: at(12) });
          const first = await providers.results.listResponsePage(survey, { limit: 2 });
          expect(first.items.map((item) => item.id)).toEqual([sid(1), sid(2)]);
          await append(survey, sid(4), { submittedAt: at(14) });
          await append(survey, sid(5), { submittedAt: at(10) });
          const rest = await providers.results.listResponsePage(survey, {
            limit: 10,
            after: first.next!,
          });
          expect(rest.items.map((item) => item.id)).toEqual([sid(3), sid(4)]);
          expect(rest.next).toBeNull();
          const again = await walk(survey, 2);
          expect(ids(again)).toEqual([sid(1), sid(5), sid(2), sid(3), sid(4)]);
        });

        it("returns copies the caller can change", async () => {
          const page = await providers.results.listResponsePage(surveyFeedback, { limit: 5 });
          (page.items[0]!.data as Record<string, unknown>).satisfaction = 99;
          const again = await providers.results.listResponsePage(surveyFeedback, { limit: 5 });
          expect(again.items).toStrictEqual(feedbackResponses);
        });
      });
    });

    describe("views", () => {
      const state = {
        elements: [{ name: "q1", isVisible: false }],
        note: "Ünïcødé 😀 & < > \" '",
      };
      const get = (surveyId: string, userId: string, view: "summary" | "table" = "summary") =>
        providers.views.getView(surveyId, userId, view);

      it("falls back to the legacy layouts of fixture 01 and to null elsewhere", async () => {
        expect(await get(surveyFeedback.id, OWNER_ID, "summary")).toEqual(
          legacyFeedbackSummaryView,
        );
        expect(await get(surveyFeedback.id, OWNER_ID, "table")).toEqual(legacyFeedbackTableView);
        expect(await get(surveyCampaign.id, OWNER_ID, "summary")).toBeNull();
      });

      it("saves, replaces, resets and saves again, per user, survey and view", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const other = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const user = randomUUID();
        expect(await get(survey.id, user)).toBeNull();

        await providers.views.saveView(survey.id, user, "summary", state);
        expect(await get(survey.id, user)).toEqual(state);
        expect(await get(survey.id, user, "table")).toBeNull();
        expect(await get(survey.id, randomUUID())).toBeNull();
        expect(await get(other.id, user)).toBeNull();

        await providers.views.saveView(survey.id, user, "summary", { replaced: true });
        expect(await get(survey.id, user)).toEqual({ replaced: true });
        expect(await get(survey.id.toUpperCase(), user.toUpperCase())).toEqual({ replaced: true });

        await providers.views.resetView(survey.id, user, "summary");
        expect(await get(survey.id, user)).toBeNull();
        await providers.views.resetView(survey.id, user, "summary");
        expect(await get(survey.id, user)).toBeNull();

        await providers.views.saveView(survey.id, user, "summary", state);
        expect(await get(survey.id, user)).toEqual(state);
      });

      it("hides the legacy layout after a reset, for that user and view only", async () => {
        const user = randomUUID();
        await providers.views.resetView(surveyFeedback.id, user, "summary");
        expect(await get(surveyFeedback.id, user, "summary")).toBeNull();
        expect(await get(surveyFeedback.id, user, "table")).toEqual(legacyFeedbackTableView);
        expect(await get(surveyFeedback.id, randomUUID(), "summary")).toEqual(
          legacyFeedbackSummaryView,
        );
        await providers.views.saveView(surveyFeedback.id, user, "summary", state);
        expect(await get(surveyFeedback.id, user, "summary")).toEqual(state);
      });

      it("does not change the survey record", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const user = randomUUID();
        await providers.views.saveView(survey.id, user, "table", state);
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(survey);
        await providers.views.resetView(survey.id, user, "table");
        expect(await providers.surveys.getSurvey(survey.id)).toEqual(survey);
      });

      it("is not copied by cloneSurvey", async () => {
        const source = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const user = randomUUID();
        await providers.views.saveView(source.id, user, "summary", state);
        const copy = newSurvey(freshScope());
        await providers.surveys.cloneSurvey(source.id, copy);
        expect(await get(copy.id, user)).toBeNull();
        expect(await get(source.id, user)).toEqual(state);
      });

      it("is emptied by deleteSurvey, for every user and both views", async () => {
        const survey = await providers.surveys.createSurvey(newSurvey(freshScope()));
        const users = [randomUUID(), randomUUID()];
        for (const user of users) {
          await providers.views.saveView(survey.id, user, "summary", state);
          await providers.views.saveView(survey.id, user, "table", state);
        }
        expect(await providers.surveys.deleteSurvey(survey.id)).toBe(true);
        for (const user of users) {
          expect(await get(survey.id, user, "summary")).toBeNull();
          expect(await get(survey.id, user, "table")).toBeNull();
        }
      });

      it("reads null and refuses writes for ids that are not GUIDs", async () => {
        const user = randomUUID();
        expect(await get("not-a-guid", user)).toBeNull();
        expect(await get(surveyFeedback.id, "not-a-guid")).toBeNull();
        await expect(
          providers.views.saveView("not-a-guid", user, "summary", state),
        ).rejects.toThrow();
        await expect(
          providers.views.saveView(surveyFeedback.id, "x", "summary", state),
        ).rejects.toThrow();
        await expect(providers.views.resetView("not-a-guid", user, "summary")).rejects.toThrow();
        await expect(
          providers.views.resetView(surveyFeedback.id, "x", "summary"),
        ).rejects.toThrow();
      });
    });

    describe("files", () => {
      const fileRecord = (
        surveyId: string,
        over: Partial<StoredFileRecord> = {},
      ): StoredFileRecord => ({
        id: newFileId(surveyId),
        surveyId,
        kind: "asset",
        name: "logo.png",
        contentType: "image/png",
        size: PNG.length,
        createdAt: "2026-09-01T10:00:00.000Z",
        ...over,
      });
      const read = async (id: string) => {
        const found = await providers.files.getFile(id);
        if (!found) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of found.content) chunks.push(chunk as Buffer);
        return { file: found.file, bytes: Buffer.concat(chunks) };
      };
      const put = async (
        surveyId: string,
        bytes: Buffer = PNG,
        over: Partial<StoredFileRecord> = {},
      ) => {
        const file = fileRecord(surveyId, { size: bytes.length, ...over });
        await providers.files.putFile(file, bytes);
        return file;
      };
      /** A fresh survey id (the store does not need the survey to exist), files removed at the end. */
      const surveyIds: string[] = [];
      const freshSurveyId = (): string => {
        const id = randomUUID();
        surveyIds.push(id);
        return id;
      };
      afterAll(async () => {
        for (const id of surveyIds) await providers.files.deleteSurveyFiles(id);
      });

      it("stores a file and reads back its record and bytes, in any id case", async () => {
        const surveyId = freshSurveyId();
        const file = await put(surveyId);
        const found = await read(file.id);
        expect(found?.file).toEqual(file);
        expect(found?.bytes.equals(PNG)).toBe(true);
        expect((await read(file.id.toUpperCase()))?.file).toEqual(file);
      });

      it("answers null for a well-formed unknown id and for a malformed id", async () => {
        expect(await providers.files.getFile(newFileId(freshSurveyId()))).toBeNull();
        expect(await providers.files.getFile("not-a-file-id")).toBeNull();
        expect(await providers.files.getFile("")).toBeNull();
      });

      it("rejects a second put of the same id and keeps the first file", async () => {
        const file = await put(freshSurveyId());
        const other = Buffer.concat([PNG, Buffer.from("more")]);
        await expect(
          providers.files.putFile({ ...file, size: other.length, name: "other.png" }, other),
        ).rejects.toThrow();
        const found = await read(file.id);
        expect(found?.file).toEqual(file);
        expect(found?.bytes.equals(PNG)).toBe(true);
      });

      it("keeps a non-ASCII name with spaces and quotes", async () => {
        const file = await put(freshSurveyId(), PNG, { name: 'Логотип "ü" 1.png' });
        expect((await read(file.id))?.file.name).toBe('Логотип "ü" 1.png');
      });

      it("round-trips a 5 MiB file byte for byte", async () => {
        const bytes = Buffer.concat([PNG, randomBytes(5 * 1024 * 1024 - PNG.length)]);
        const file = await put(freshSurveyId(), bytes);
        const found = await read(file.id);
        expect(found?.file.size).toBe(bytes.length);
        expect(found?.bytes.equals(bytes)).toBe(true);
      });

      it("counts the sizes of a survey's assets only", async () => {
        const surveyId = freshSurveyId();
        const other = freshSurveyId();
        expect(await providers.files.usage(surveyId, "asset")).toBe(0);
        const sizes = [PNG.length, PNG.length + 10, PNG.length + 200];
        const files = [];
        for (const size of sizes) {
          files.push(await put(surveyId, Buffer.concat([PNG, Buffer.alloc(size - PNG.length)])));
        }
        await put(other);
        expect(await providers.files.usage(surveyId, "asset")).toBe(
          sizes.reduce((a, b) => a + b, 0),
        );
        expect(await providers.files.deleteFile(files[1]!.id)).toBe(true);
        expect(await providers.files.usage(surveyId, "asset")).toBe(sizes[0]! + sizes[2]!);
        expect(await providers.files.getFile(files[1]!.id)).toBeNull();
        expect(await providers.files.deleteFile(files[1]!.id)).toBe(false);
        expect(await providers.files.deleteFile(newFileId(freshSurveyId()))).toBe(false);
      });

      it("deletes all files of one survey and leaves another's", async () => {
        const surveyId = freshSurveyId();
        const other = freshSurveyId();
        const mine = [await put(surveyId), await put(surveyId)];
        const theirs = await put(other);
        expect(await providers.files.deleteSurveyFiles(surveyId)).toBe(2);
        for (const file of mine) expect(await providers.files.getFile(file.id)).toBeNull();
        expect(await providers.files.usage(surveyId, "asset")).toBe(0);
        expect((await read(theirs.id))?.file).toEqual(theirs);
        expect(await providers.files.usage(other, "asset")).toBe(PNG.length);
        expect(await providers.files.deleteSurveyFiles(freshSurveyId())).toBe(0);
      });

      it("counts files per kind, copies only assets and deletes every kind", async () => {
        const surveyId = freshSurveyId();
        const target = freshSurveyId();
        await put(surveyId, PNG, { kind: "response" });
        await put(surveyId, PNG, { kind: "response" });
        const asset = await put(surveyId);
        expect(await providers.files.usage(surveyId, "asset")).toBe(PNG.length);
        expect(await providers.files.usage(surveyId, "response")).toBe(2 * PNG.length);
        const map = await providers.files.copySurveyAssets(
          surveyId,
          target,
          "2026-09-05T12:00:00.000Z",
        );
        expect([...map.keys()]).toEqual([asset.id]);
        expect(await providers.files.usage(target, "response")).toBe(0);
        expect(await providers.files.deleteSurveyFiles(surveyId)).toBe(3);
      });

      it("copies a survey's assets under new ids of the target survey", async () => {
        const source = freshSurveyId();
        const target = freshSurveyId();
        const bytes = Buffer.concat([PNG, Buffer.from("padding")]);
        const first = await put(source, PNG, { name: "a b.png" });
        const second = await put(source, bytes, { name: "ü.png" });
        const copiedAt = "2026-09-05T12:00:00.000Z";
        const map = await providers.files.copySurveyAssets(source, target, copiedAt);
        expect([...map.keys()].sort()).toEqual([first.id, second.id].sort());
        for (const original of [first, second]) {
          const newId = map.get(original.id)!;
          expect(surveyIdOfFile(newId)).toBe(target);
          const copy = await read(newId);
          const src = await read(original.id);
          expect(copy?.file).toEqual({
            ...original,
            id: newId,
            surveyId: target,
            createdAt: copiedAt,
          });
          expect(copy?.bytes.equals(src!.bytes)).toBe(true);
          expect(src?.file).toEqual(original);
        }
        expect(await providers.files.usage(target, "asset")).toBe(
          await providers.files.usage(source, "asset"),
        );
        expect([
          ...(await providers.files.copySurveyAssets(freshSurveyId(), target, copiedAt)),
        ]).toEqual([]);
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
