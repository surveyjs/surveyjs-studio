import { describe, expect, it } from "vitest";
import type { LegacyOrganizationUserRow } from "../../providers/azure-legacy/rows.js";
import { mapProject } from "./projects.js";
import { createReport } from "./report.js";

const P = "AAAAAAAA-0000-4000-8000-000000000001";
const org = { id: P, name: "Team", happendat: new Date("2020-01-01T00:00:00.000Z") };
const M1 = "CCCCCCCC-0000-4000-8000-000000000001";
const M2 = "CCCCCCCC-0000-4000-8000-000000000002";
const M3 = "CCCCCCCC-0000-4000-8000-000000000003";
const member = (
  id: string,
  userid: string,
  role: string | null,
  happendat: string | null = "2021-01-01T00:00:00.000Z",
): LegacyOrganizationUserRow => ({
  id,
  organizationid: P,
  userid,
  role,
  happendat: happendat === null ? null : new Date(happendat),
});
const U1 = "BBBBBBBB-0000-4000-8000-000000000001";
const U2 = "BBBBBBBB-0000-4000-8000-000000000002";

describe("mapProject", () => {
  it("maps a project: creator from the row whose id is the project's, creation time from it", () => {
    const result = mapProject(
      org,
      [member(M1, U2, "user"), member(P, U1, "admin", "2019-05-05T00:00:00.000Z")],
      createReport(),
    );
    expect(result?.project).toEqual({
      id: P.toLowerCase(),
      name: "Team",
      creatorId: U1.toLowerCase(),
      createdAt: "2019-05-05T00:00:00.000Z",
    });
    expect(result?.members.map((m) => [m.projectId, m.userId, m.role])).toEqual([
      [P.toLowerCase(), U2.toLowerCase(), "user"],
      [P.toLowerCase(), U1.toLowerCase(), "admin"],
    ]);
  });

  it("has no creator when no row's id is the project's", () => {
    const result = mapProject(org, [member(M1, U1, "user")], createReport());
    expect(result?.project.creatorId).toBeNull();
    expect(result?.project.createdAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("merges a user's rows into one, an admin row winning, with the earliest and latest times", () => {
    const result = mapProject(
      org,
      [
        member(M1, U1, "User", "2021-01-01T00:00:00.000Z"),
        member(M2, U1, "ADMIN", "2022-01-01T00:00:00.000Z"),
        member(M3, U1, "user", "2020-06-01T00:00:00.000Z"),
      ],
      createReport(),
    );
    expect(result?.members).toEqual([
      {
        projectId: P.toLowerCase(),
        userId: U1.toLowerCase(),
        role: "admin",
        createdAt: "2020-06-01T00:00:00.000Z",
        updatedAt: "2022-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("skips and reports a project without members", () => {
    const report = createReport();
    expect(mapProject(org, [], report)).toBeNull();
    expect(report.counts()).toEqual({ "skipped:project": 1 });
  });

  it("ignores and reports rows with an unknown role; a user with only such rows is no member", () => {
    const report = createReport();
    const result = mapProject(org, [member(M1, U1, "boss"), member(M2, U2, "user")], report);
    expect(result?.members.map((m) => m.userId)).toEqual([U2.toLowerCase()]);
    expect(report.counts()).toEqual({ member_role_unknown: 1 });
  });

  it("skips a project whose members all have unknown roles, as member-less", () => {
    const report = createReport();
    expect(mapProject(org, [member(M1, U1, "boss"), member(M2, U2, null)], report)).toBeNull();
    expect(report.counts()).toEqual({ member_role_unknown: 2, "skipped:project": 1 });
  });

  it("skips a project whose id is not a GUID, and rows whose user is not", () => {
    const report = createReport();
    expect(mapProject({ ...org, id: "x" }, [member(P, U1, "user")], report)).toBeNull();
    const result = mapProject(org, [member(P, "nope", "user"), member(M2, U2, "user")], report);
    expect(result?.members.map((m) => m.userId)).toEqual([U2.toLowerCase()]);
    expect(report.counts()).toEqual({ "skipped:project": 1, "skipped:member": 1 });
  });
});
