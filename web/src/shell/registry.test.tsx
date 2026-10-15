import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUser } from "../test/server";
import { renderShell } from "./registry";

function shellFor(name: string) {
  return renderShell(name, {
    user: currentUser,
    notices: [],
    links: {},
    onSignOut: () => {},
    children: <p>page</p>,
  });
}

beforeEach(() => localStorage.clear());

describe("renderShell", () => {
  it.each(["plain", "something-else", "toString"])(
    "renders the plain shell for %s: the user, a Sign Out button and the page",
    (name) => {
      render(shellFor(name));

      expect(screen.getByText("Olivia Owner")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign Out" })).toBeTruthy();
      expect(screen.getByText("page")).toBeTruthy();
      expect(document.querySelector(".v2-class---top-bar")).toBeNull();
    },
  );

  it("renders the surveyjs.io shell for surveyjs-site", async () => {
    render(shellFor("surveyjs-site"));

    // The shell is a lazy chunk; on a busy test run its first import can take over a second.
    expect(await screen.findByText("page", undefined, { timeout: 5000 })).toBeTruthy();
    const header = screen.getByRole("banner");
    expect(header.classList.contains("v2-class---top-bar")).toBe(true);
    expect(within(header).getByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(screen.getByRole("contentinfo").classList.contains("v2-class---footer")).toBe(true);
  });
});
