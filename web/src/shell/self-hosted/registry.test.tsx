import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { appConfig, currentUser } from "../../test/server";
import { renderAnonymousPage, renderPublicPage, renderShell } from "../registry";

// The surveyjs.io stylesheet, seen as a marker: the self-hosted shell must never load it.
vi.mock("../surveyjs-site/SiteStyles", () => ({
  SiteStyles: ({ children }: { children: ReactNode }) => (
    <div data-testid="site-styles">{children}</div>
  ),
}));

const config = { ...appConfig, shell: "self-hosted" };

/** The shell's own frame (its `sh-app` root), around the page. */
async function expectOwnFrame() {
  expect(await screen.findByText("page")).toBeTruthy();
  const frame = document.querySelector(".sh-app");
  expect(frame).not.toBeNull();
  expect(frame!.textContent).toContain("page");
  expect(screen.queryByTestId("site-styles")).toBeNull();
  expect(document.querySelector("[class*='v2-class---top-bar']")).toBeNull();
}

describe("the self-hosted shell's own frame and styles", () => {
  it("frames the signed-in pages with its own classes, without the surveyjs.io styles", async () => {
    render(
      renderShell("self-hosted", {
        user: currentUser,
        notices: [],
        links: {},
        onSignOut: () => {},
        children: <p>page</p>,
      }),
    );
    await expectOwnFrame();
    for (const name of [
      "sh-header",
      "sh-brand",
      "sh-nav",
      "sh-account",
      "sh-content",
      "sh-footer",
    ]) {
      expect(document.querySelector(`.${name}`), name).not.toBeNull();
    }
  });

  it.each([
    ["the sign-in and set-password pages", renderAnonymousPage],
    ["the public results page", renderPublicPage],
  ])("frames %s the same way", async (_name, renderPage) => {
    render(renderPage(config, <p>page</p>));
    await expectOwnFrame();
  });
});
