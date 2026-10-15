import { describe, expect, it } from "vitest";
import type { ProjectMembership } from "../domain/types.js";
import { projectListOrder } from "./ordering.js";

const membership = (id: string, name: string): ProjectMembership => ({
  project: { id, name },
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
