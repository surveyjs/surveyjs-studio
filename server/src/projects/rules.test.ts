import { describe, expect, it } from "vitest";
import {
  decideMemberErasure,
  decideRemoval,
  decideRoleChange,
  surveyReceiver,
  type ErasureFacts,
  type MembershipFacts,
} from "./rules.js";

/** Users `a`, `b` and `c` exist; `o` is an orphan (its account is gone). */
type Row = readonly [userId: string, role: string | null, userExists: boolean];
const rows = (...list: Row[]): MembershipFacts[] =>
  list.map(([userId, role, userExists]) => ({ userId, role, userExists }));

describe("decideRoleChange", () => {
  const adminAndUser = rows(["a", "admin", true], ["b", "user", true]);

  it("refuses to demote the only admin", () => {
    expect(decideRoleChange(adminAndUser, "a", "user")).toBe("last-admin");
  });

  it("promotes a member", () => {
    expect(decideRoleChange(adminAndUser, "b", "admin")).toBe("changed");
  });

  it("answers unchanged when the role is already set, whatever its stored case", () => {
    expect(decideRoleChange(adminAndUser, "a", "admin")).toBe("unchanged");
    expect(decideRoleChange(rows(["a", "Admin", true]), "a", "admin")).toBe("unchanged");
  });

  it("demotes an admin while another admin remains", () => {
    expect(decideRoleChange(rows(["a", "admin", true], ["b", "admin", true]), "a", "user")).toBe(
      "changed",
    );
  });

  it("does not count an orphan as an admin", () => {
    const withOrphan = rows(["a", "admin", true], ["o", "admin", false]);
    expect(decideRoleChange(withOrphan, "a", "user")).toBe("last-admin");
    expect(decideRoleChange(withOrphan, "o", "user")).toBe("not-found");
  });

  it("answers not-found for a user without a row", () => {
    expect(decideRoleChange(adminAndUser, "c", "admin")).toBe("not-found");
  });

  it("changes a user whose duplicate rows disagree, either way", () => {
    const duplicates = rows(["a", "admin", true], ["a", "user", true], ["b", "admin", true]);
    expect(decideRoleChange(duplicates, "a", "admin")).toBe("changed");
    expect(decideRoleChange(duplicates, "a", "user")).toBe("changed");
  });

  it("compares ids case-insensitively", () => {
    expect(decideRoleChange(adminAndUser, "A", "user")).toBe("last-admin");
    expect(decideRoleChange(rows(["A", "admin", true], ["b", "admin", true]), "a", "user")).toBe(
      "changed",
    );
  });
});

describe("decideRemoval", () => {
  const adminAndUser = rows(["a", "admin", true], ["b", "user", true]);

  it("removes a plain member", () => {
    expect(decideRemoval(adminAndUser, "b")).toBe("removed");
  });

  it("refuses to remove the only admin", () => {
    expect(decideRemoval(adminAndUser, "a")).toBe("last-admin");
  });

  it("refuses to remove the sole member, admin or not", () => {
    expect(decideRemoval(rows(["a", "admin", true]), "a")).toBe("last-admin");
    expect(decideRemoval(rows(["a", "user", true]), "a")).toBe("last-admin");
  });

  it("removes an admin while another admin remains", () => {
    expect(decideRemoval(rows(["a", "admin", true], ["b", "admin", true]), "a")).toBe("removed");
  });

  it("does not count an orphan as an admin or as a member", () => {
    const withOrphan = rows(["a", "admin", true], ["o", "admin", false]);
    expect(decideRemoval(withOrphan, "a")).toBe("last-admin");
    expect(decideRemoval(withOrphan, "o")).toBe("not-found");
  });

  it("answers not-found for a user without a row", () => {
    expect(decideRemoval(adminAndUser, "c")).toBe("not-found");
  });

  it("compares ids case-insensitively", () => {
    expect(decideRemoval(adminAndUser, "B")).toBe("removed");
  });
});

describe("surveyReceiver", () => {
  it("gives the surveys to the owner while they are a visible member", () => {
    expect(surveyReceiver("a", ["a", "b"], "b")).toBe("a");
  });

  it("gives the surveys to the deleting admin when there is no owner", () => {
    expect(surveyReceiver(null, ["a", "b"], "b")).toBe("b");
  });

  it("gives the surveys to the deleting admin when the owner is not a visible member", () => {
    expect(surveyReceiver("o", ["a", "b"], "b")).toBe("b");
  });

  it("answers in lower case", () => {
    expect(surveyReceiver("A", ["a", "B"], "B")).toBe("a");
    expect(surveyReceiver(null, ["A", "B"], "B")).toBe("b");
  });
});

describe("decideMemberErasure", () => {
  /** The erased user is `e`; `a` and `b` exist; `o` is an orphan. */
  type ErasureRow = readonly [
    userId: string,
    role: string | null,
    userExists: boolean,
    displayName: string,
  ];
  const facts = (...list: ErasureRow[]): ErasureFacts[] =>
    list.map(([userId, role, userExists, displayName]) => ({
      userId,
      role,
      userExists,
      displayName,
    }));

  it("answers not-member when the user has no row", () => {
    expect(decideMemberErasure(facts(["a", "admin", true, "Ann"]), "e")).toEqual({
      kind: "not-member",
    });
  });

  it("answers last-member when no other visible member remains", () => {
    expect(decideMemberErasure(facts(["e", "admin", true, "Erin"]), "e")).toEqual({
      kind: "last-member",
    });
    expect(
      decideMemberErasure(facts(["e", "admin", true, "Erin"], ["o", "admin", false, ""]), "e"),
    ).toEqual({ kind: "last-member" });
  });

  it("erases an orphan row of the user and promotes the next visible member", () => {
    expect(
      decideMemberErasure(facts(["e", "admin", false, ""], ["a", "user", true, "Ann"]), "e"),
    ).toEqual({ kind: "promote", successorId: "a" });
  });

  it("promotes the first member by display name ignoring case", () => {
    expect(
      decideMemberErasure(
        facts(["e", "admin", true, "Erin"], ["a", "user", true, "bob"], ["b", "user", true, "Ann"]),
        "e",
      ),
    ).toEqual({ kind: "promote", successorId: "b" });
  });

  it("breaks a tie on the name with the lower user id", () => {
    expect(
      decideMemberErasure(
        facts(["e", "admin", true, "Erin"], ["b", "user", true, "Ann"], ["a", "user", true, "ann"]),
        "e",
      ),
    ).toEqual({ kind: "promote", successorId: "a" });
  });

  it("removes the user while another visible admin remains, whatever its stored case", () => {
    expect(
      decideMemberErasure(facts(["e", "user", true, "Erin"], ["a", "admin", true, "Ann"]), "e"),
    ).toEqual({ kind: "remove" });
    expect(
      decideMemberErasure(facts(["e", "admin", true, "Erin"], ["a", "Admin", true, "Ann"]), "e"),
    ).toEqual({ kind: "remove" });
  });

  it("promotes a member of a project left without any admin (a repair)", () => {
    expect(
      decideMemberErasure(facts(["e", "user", true, "Erin"], ["a", "user", true, "Ann"]), "e"),
    ).toEqual({ kind: "promote", successorId: "a" });
  });

  it("treats duplicate rows of the user as one", () => {
    expect(
      decideMemberErasure(
        facts(
          ["e", "admin", true, "Erin"],
          ["e", "user", true, "Erin"],
          ["a", "user", true, "Ann"],
        ),
        "e",
      ),
    ).toEqual({ kind: "promote", successorId: "a" });
  });

  it("compares ids ignoring case and answers the successor in lower case", () => {
    expect(
      decideMemberErasure(facts(["E", "admin", true, "Erin"], ["A", "user", true, "Ann"]), "e"),
    ).toEqual({ kind: "promote", successorId: "a" });
    expect(
      decideMemberErasure(facts(["e", "admin", true, "Erin"], ["a", "admin", true, "Ann"]), "E"),
    ).toEqual({ kind: "remove" });
  });
});
