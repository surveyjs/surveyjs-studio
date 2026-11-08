import { describe, expect, it } from "vitest";
import { decideAccountChange, nextStatus } from "./rules.js";

const activeAdmin = { instanceRole: "admin", status: "active" } as const;

describe("decideAccountChange", () => {
  it("refuses to take the last active admin away: demote, disable or delete", () => {
    expect(decideAccountChange(activeAdmin, { instanceRole: "user", status: "active" }, 1)).toBe(
      "last-instance-admin",
    );
    expect(decideAccountChange(activeAdmin, { instanceRole: "admin", status: "disabled" }, 1)).toBe(
      "last-instance-admin",
    );
    expect(decideAccountChange(activeAdmin, null, 1)).toBe("last-instance-admin");
  });

  it("allows it while another active admin remains", () => {
    expect(decideAccountChange(activeAdmin, null, 2)).toBe("allowed");
    expect(decideAccountChange(activeAdmin, { instanceRole: "user", status: "active" }, 2)).toBe(
      "allowed",
    );
  });

  it("allows any change to an account that is not an active admin", () => {
    const disabledAdmin = { instanceRole: "admin", status: "disabled" } as const;
    expect(decideAccountChange(disabledAdmin, null, 1)).toBe("allowed");
    const user = { instanceRole: "user", status: "active" } as const;
    expect(decideAccountChange(user, null, 1)).toBe("allowed");
  });

  it("allows a change that keeps the last admin an active admin", () => {
    expect(decideAccountChange(activeAdmin, activeAdmin, 1)).toBe("allowed");
  });
});

describe("nextStatus", () => {
  it("disables any account, and enables one by whether it has a password", () => {
    expect(nextStatus("active", "disabled", true)).toBe("disabled");
    expect(nextStatus("invited", "disabled", false)).toBe("disabled");
    expect(nextStatus("disabled", "active", true)).toBe("active");
    expect(nextStatus("disabled", "active", false)).toBe("invited");
    expect(nextStatus("invited", "active", false)).toBe("invited");
    expect(nextStatus("active", undefined, true)).toBe("active");
  });
});
