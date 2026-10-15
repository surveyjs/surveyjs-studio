import { describe, expect, it } from "vitest";
import { applySurveyChanges } from "./survey-changes.js";
import type { SurveyRecord } from "./types.js";

const record: SurveyRecord = {
  id: "22222222-0000-4000-8000-a00000000001",
  name: "Before",
  owner: { kind: "personal", userId: "11111111-0000-4000-8000-a00000000001" },
  creatorId: "11111111-0000-4000-8000-a00000000001",
  postId: "33333333-0000-4000-8000-a00000000001",
  resultId: "44444444-0000-4000-8000-a00000000001",
  published: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  settings: { publicResults: true, storeRespondentIp: true, useCookies: true },
};
const NOW = "2026-10-15T08:30:00.000Z";
const PROJECT = "55555555-0000-4000-8000-a00000000001";
const MOVER = "11111111-0000-4000-8000-a00000000002";

describe("applySurveyChanges", () => {
  it("renames", () => {
    expect(applySurveyChanges(record, { name: "After", updatedAt: NOW })).toEqual({
      ...record,
      name: "After",
      updatedAt: NOW,
    });
  });

  it("moves to a project and makes the mover the creator", () => {
    const moved = applySurveyChanges(record, {
      move: { owner: { kind: "project", projectId: PROJECT }, creatorId: MOVER },
      updatedAt: NOW,
    });
    expect(moved).toEqual({
      ...record,
      owner: { kind: "project", projectId: PROJECT },
      creatorId: MOVER,
      updatedAt: NOW,
    });
  });

  it("moves to a Personal scope with the new creator", () => {
    const inProject: SurveyRecord = { ...record, owner: { kind: "project", projectId: PROJECT } };
    const moved = applySurveyChanges(inProject, {
      move: { owner: { kind: "personal", userId: MOVER }, creatorId: MOVER },
      updatedAt: NOW,
    });
    expect(moved.owner).toEqual({ kind: "personal", userId: MOVER });
    expect(moved.creatorId).toBe(MOVER);
  });

  it("keeps ids lower-case", () => {
    const moved = applySurveyChanges(record, {
      move: {
        owner: { kind: "project", projectId: PROJECT.toUpperCase() },
        creatorId: MOVER.toUpperCase(),
      },
      updatedAt: NOW,
    });
    expect(moved.owner).toEqual({ kind: "project", projectId: PROJECT });
    expect(moved.creatorId).toBe(MOVER);
  });

  it("publishes and archives", () => {
    expect(applySurveyChanges(record, { published: true, updatedAt: NOW })).toEqual({
      ...record,
      published: true,
      updatedAt: NOW,
    });
    expect(applySurveyChanges(record, { archived: true, updatedAt: NOW })).toEqual({
      ...record,
      archived: true,
      updatedAt: NOW,
    });
  });

  it("changes publicResults alone and keeps the other settings", () => {
    const changed = applySurveyChanges(record, {
      settings: { publicResults: false },
      updatedAt: NOW,
    });
    expect(changed.settings).toEqual({
      publicResults: false,
      storeRespondentIp: true,
      useCookies: true,
    });
  });

  it("changes storeRespondentIp alone and keeps the other settings", () => {
    const changed = applySurveyChanges(record, {
      settings: { storeRespondentIp: false },
      updatedAt: NOW,
    });
    expect(changed.settings).toEqual({
      publicResults: true,
      storeRespondentIp: false,
      useCookies: true,
    });
  });

  it("applies every change at once", () => {
    const changed = applySurveyChanges(record, {
      name: "All",
      move: { owner: { kind: "project", projectId: PROJECT }, creatorId: MOVER },
      published: true,
      archived: true,
      settings: { publicResults: false, storeRespondentIp: false },
      updatedAt: NOW,
    });
    expect(changed).toEqual({
      ...record,
      name: "All",
      owner: { kind: "project", projectId: PROJECT },
      creatorId: MOVER,
      published: true,
      archived: true,
      settings: { publicResults: false, storeRespondentIp: false, useCookies: true },
      updatedAt: NOW,
    });
  });

  it("always takes updatedAt and changes nothing else without other changes", () => {
    expect(applySurveyChanges(record, { updatedAt: NOW })).toEqual({ ...record, updatedAt: NOW });
    expect(applySurveyChanges(record, { settings: {}, updatedAt: NOW })).toEqual({
      ...record,
      updatedAt: NOW,
    });
  });

  it("does not change the input record", () => {
    const input = structuredClone(record);
    applySurveyChanges(input, {
      name: "X",
      move: { owner: { kind: "project", projectId: PROJECT }, creatorId: MOVER },
      published: true,
      archived: true,
      settings: { publicResults: false },
      updatedAt: NOW,
    });
    expect(input).toEqual(record);
  });
});
