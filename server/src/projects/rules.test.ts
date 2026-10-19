import { describe, expect, it } from "vitest";
import { decideRemoval, decideRoleChange, surveyReceiver, type MembershipFacts } from "./rules.js";

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
