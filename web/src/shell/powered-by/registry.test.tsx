import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { appConfig, currentUser } from "../../test/server";
import { renderAnonymousPage, renderPublicPage, renderShell } from "../registry";

// The site's stylesheet, seen as a marker: the powered-by pages use its component styles.
vi.mock("../surveyjs-site/SiteStyles", () => ({
  SiteStyles: ({ children }: { children: ReactNode }) => (
    <div data-testid="site-styles">{children}</div>
  ),
}));

const config = { ...appConfig, shell: "powered-by" };

describe("the powered-by shell's page styles", () => {
  it("gives the signed-in pages the site's component styles, under its own header", async () => {
    render(
      renderShell("powered-by", {
        user: currentUser,
        notices: [],
        links: {},
        onSignOut: () => {},
        children: <p>page</p>,
      }),
    );
    expect((await screen.findByTestId("site-styles")).textContent).toContain("page");
    expect(document.querySelector(".v2-class---top-bar")).toBeNull();
  });

  it.each([
    ["the sign-in and set-password pages", renderAnonymousPage],
    ["the public results page", renderPublicPage],
  ])("gives %s the same styles", async (_name, renderPage) => {
    render(renderPage(config, <p>page</p>));
    expect((await screen.findByTestId("site-styles")).textContent).toContain("page");
  });
});
