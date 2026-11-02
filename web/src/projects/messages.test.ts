import { describe, expect, it } from "vitest";
import { ApiError, type Problem } from "../api/client";
import {
  actionFailedText,
  alreadyMemberText,
  isProjectGone,
  LAST_ADMIN_TEXT,
  projectErrorText,
  removeMemberConfirmation,
  type ProjectAction,
} from "./messages";

const problem = (status: number, code: Problem["code"]) =>
  new ApiError({ type: "about:blank", title: code, status, code });

describe("projectErrorText", () => {
  it("names the unregistered address", () => {
    const text = projectErrorText(problem(404, "user-not-found"), "add", "nobody@example.test");
    expect(text).toBe(
      "nobody@example.test is not a registered surveyjs.io user. Ask them to sign up first.",
    );
    expect(text).toContain("not a registered");
  });

  it("maps the known codes", () => {
    expect(projectErrorText(problem(409, "already-member"), "add", "a@example.test")).toBe(
      alreadyMemberText("a@example.test"),
    );
    expect(projectErrorText(problem(409, "last-admin"), "remove")).toBe(LAST_ADMIN_TEXT);
    expect(projectErrorText(problem(403, "forbidden"), "rename")).toBe(
      "Only project admins can do this.",
    );
  });

  it("names an address that is already invited", () => {
    expect(projectErrorText(problem(409, "already-invited"), "add", "a@example.test")).toBe(
      "a@example.test is already invited.",
    );
  });

  it("asks for a name only for create and rename", () => {
    const error = problem(400, "validation-failed");
    expect(projectErrorText(error, "create")).toBe("Enter a project name.");
    expect(projectErrorText(error, "rename")).toBe("Enter a project name.");
    expect(projectErrorText(error, "add")).toBe("Could not add the member. Please try again.");
  });

  it("falls back to the action text", () => {
    expect(projectErrorText(problem(500, "internal-error"), "delete")).toBe(
      "Could not delete the project. Please try again.",
    );
    expect(projectErrorText(new TypeError("x"), "leave")).toBe(
      "Could not leave the project. Please try again.",
    );
  });

  it("has a text for every action", () => {
    const actions: ProjectAction[] = [
      "create",
      "rename",
      "delete",
      "leave",
      "add",
      "change-role",
      "remove",
      "load-members",
    ];
    expect(actions.map(actionFailedText)).toEqual([
      "Could not create the project. Please try again.",
      "Could not rename the project. Please try again.",
      "Could not delete the project. Please try again.",
      "Could not leave the project. Please try again.",
      "Could not add the member. Please try again.",
      "Could not change the member's role. Please try again.",
      "Could not remove the member. Please try again.",
      "Could not load the members. Please try again.",
    ]);
  });
});

describe("confirmations and isProjectGone", () => {
  it("names the member", () => {
    expect(removeMemberConfirmation("Mia Member")).toBe("Remove Mia Member from this project?");
  });

  it("is true only for not-found", () => {
    expect(isProjectGone(problem(404, "not-found"))).toBe(true);
    expect(isProjectGone(problem(404, "user-not-found"))).toBe(false);
    expect(isProjectGone(new Error("x"))).toBe(false);
  });
});
