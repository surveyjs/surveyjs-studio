import { describe, expect, it } from "vitest";
import type { SurveyOwner, SurveyRecord } from "../domain/types.js";
import { surveyChangesFromPatch } from "./patch.js";

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT = "bbbbbbbb-0000-4000-8000-000000000001";
const NOW = "2026-10-15T08:30:00.000Z";

function survey(owner: SurveyOwner): SurveyRecord {
  return {
    id: "cccccccc-0000-4000-8000-000000000001",
    name: "Poll",
    owner,
    creatorId: "aaaaaaaa-0000-4000-8000-000000000009",
    postId: "dddddddd-0000-4000-8000-000000000001",
    resultId: "eeeeeeee-0000-4000-8000-000000000001",
    published: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

const inProject = survey({ kind: "project", projectId: PROJECT });
const personal = survey({ kind: "personal", userId: USER });
const context = { userId: USER, now: NOW };

describe("surveyChangesFromPatch", () => {
  it.each([
    ["name", { name: "Renamed" }],
    ["published", { published: true }],
    ["archived", { archived: true }],
    ["settings", { settings: { publicResults: true, storeRespondentIp: true } }],
  ])("copies %s alone", (_member, patch) => {
    expect(surveyChangesFromPatch(inProject, patch, context)).toEqual({ ...patch, updatedAt: NOW });
  });

  it("moves a project survey to the user's Personal scope, making the user its creator", () => {
    const target: SurveyOwner = { kind: "personal", userId: USER };
    expect(surveyChangesFromPatch(inProject, { projectId: null }, { ...context, target })).toEqual({
      move: { owner: target, creatorId: USER },
      updatedAt: NOW,
    });
  });

  it("moves to another project", () => {
    const target: SurveyOwner = {
      kind: "project",
      projectId: "bbbbbbbb-0000-4000-8000-000000000002",
    };
    const changes = surveyChangesFromPatch(
      personal,
      { projectId: target.projectId },
      { ...context, target },
    );
    expect(changes.move).toEqual({ owner: target, creatorId: USER });
  });

  it("does not move to the current scope, also when the ids differ in case", () => {
    const same: SurveyOwner = { kind: "project", projectId: PROJECT.toUpperCase() };
    expect(
      surveyChangesFromPatch(inProject, { projectId: PROJECT }, { ...context, target: same }),
    ).toEqual({
      updatedAt: NOW,
    });
    const own: SurveyOwner = { kind: "personal", userId: USER.toUpperCase() };
    expect(
      surveyChangesFromPatch(personal, { projectId: null }, { ...context, target: own }),
    ).toEqual({
      updatedAt: NOW,
    });
  });

  it("copies only the settings the patch names", () => {
    expect(
      surveyChangesFromPatch(inProject, { settings: { storeRespondentIp: true } }, context),
    ).toEqual({
      settings: { storeRespondentIp: true },
      updatedAt: NOW,
    });
  });

  it("ignores members it does not know and always sets updatedAt", () => {
    const patch = { unknown: 1, id: "other" } as never;
    expect(surveyChangesFromPatch(inProject, patch, context)).toEqual({ updatedAt: NOW });
  });
});
