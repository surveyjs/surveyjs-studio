import { describe, expect, it } from "vitest";
import { memberControls, projectControls } from "./controls";

describe("projectControls", () => {
  it("gives admins manage and add, plain members leave", () => {
    expect(projectControls({ role: "admin" })).toEqual({
      manage: true,
      addMember: true,
      leave: false,
    });
    expect(projectControls({ role: "user" })).toEqual({
      manage: false,
      addMember: false,
      leave: true,
    });
  });
});

describe("memberControls", () => {
  const viewer = "VIEWER-ID";

  it("lets an admin remove and promote a plain member", () => {
    expect(memberControls({ role: "admin" }, { userId: "u1", role: "user" }, viewer)).toEqual({
      remove: true,
      makeAdmin: true,
      removeAdminRights: false,
      self: false,
    });
  });

  it("lets an admin remove and demote an admin", () => {
    expect(memberControls({ role: "admin" }, { userId: "u2", role: "admin" }, viewer)).toEqual({
      remove: true,
      makeAdmin: false,
      removeAdminRights: true,
      self: false,
    });
  });

  it("gives a plain viewer nothing", () => {
    for (const role of ["user", "admin"] as const) {
      expect(memberControls({ role: "user" }, { userId: "u1", role }, viewer)).toEqual({
        remove: false,
        makeAdmin: false,
        removeAdminRights: false,
        self: false,
      });
    }
  });

  it("recognises the viewer's own row, ignoring case", () => {
    expect(
      memberControls({ role: "admin" }, { userId: "viewer-id", role: "admin" }, viewer).self,
    ).toBe(true);
  });
});
