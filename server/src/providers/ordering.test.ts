import { describe, expect, it } from "vitest";
import type { ProjectMembership, SurveyRecord } from "../domain/types.js";
import { isAfter, projectListOrder, surveyListOrder } from "./ordering.js";

const membership = (id: string, name: string): ProjectMembership => ({
  project: { id, name, ownerId: "o", createdAt: "2026-01-01T00:00:00.000Z", memberCount: 1 },
  role: "user",
});

const names = (list: ProjectMembership[]) =>
  [...list].sort(projectListOrder).map((m) => `${m.project.name}/${m.project.id}`);

describe("projectListOrder", () => {
  it("orders project names case-insensitively", () => {
    const list = [membership("1", "Zeta"), membership("2", "alpha"), membership("3", "Beta")];
    expect(names(list)).toEqual(["alpha/2", "Beta/3", "Zeta/1"]);
  });

  it("breaks a tie that differs only in case by project id", () => {
    const list = [membership("b", "news"), membership("a", "News"), membership("c", "")];
    expect(names(list)).toEqual(["/c", "News/a", "news/b"]);
  });
});

describe("isAfter", () => {
  const survey = (id: string, updatedAt: string): SurveyRecord => ({
    id,
    name: id,
    owner: { kind: "personal", userId: "u" },
    creatorId: null,
    postId: "p",
    resultId: "r",
    published: false,
    archived: false,
    createdAt: updatedAt,
    updatedAt,
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  });
  const position = { updatedAt: "2026-05-01T10:00:00.000Z", id: "b" };

  it("accepts an older survey and refuses a newer one, whatever the id", () => {
    expect(isAfter(survey("a", "2026-05-01T09:59:59.999Z"), position)).toBe(true);
    expect(isAfter(survey("z", "2026-05-01T10:00:00.001Z"), position)).toBe(false);
  });

  it("orders surveys updated at the same time by id", () => {
    expect(isAfter(survey("c", position.updatedAt), position)).toBe(true);
    expect(isAfter(survey("b", position.updatedAt), position)).toBe(false);
    expect(isAfter(survey("a", position.updatedAt), position)).toBe(false);
  });

  it("compares times as instants, so a position without milliseconds matches", () => {
    const short = { updatedAt: "2026-05-01T10:00:00Z", id: "b" };
    expect(isAfter(survey("a", "2026-05-01T10:00:00.000Z"), short)).toBe(false);
    expect(isAfter(survey("c", "2026-05-01T10:00:00.000Z"), short)).toBe(true);
  });

  it("agrees with surveyListOrder", () => {
    const list = [
      survey("b", "2026-05-01T10:00:00.000Z"),
      survey("a", "2026-05-01T10:00:00.000Z"),
      survey("c", "2026-04-01T10:00:00.000Z"),
      survey("d", "2026-06-01T10:00:00.000Z"),
    ].sort(surveyListOrder);
    list.forEach((current, index) => {
      const at = { updatedAt: current.updatedAt, id: current.id };
      expect(list.filter((s) => isAfter(s, at))).toEqual(list.slice(index + 1));
    });
  });
});
