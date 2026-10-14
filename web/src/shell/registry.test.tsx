import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("renderShell", () => {
  // Until Task 6 both known shells render the plain shell; unknown names fall back to it.
  it.each(["plain", "surveyjs-site", "something-else", "toString"])(
    "renders the user, a Sign Out button and the page for %s",
    (name) => {
      render(shellFor(name));

      expect(screen.getByText("Olivia Owner")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign Out" })).toBeTruthy();
      expect(screen.getByText("page")).toBeTruthy();
    },
  );
});
