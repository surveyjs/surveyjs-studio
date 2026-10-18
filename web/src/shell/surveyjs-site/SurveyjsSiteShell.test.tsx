import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser } from "../../test/server";
import type { ShellNotice } from "../types";
import { SurveyjsSiteShell } from "./SurveyjsSiteShell";

const links = {
  settings: "https://account.example.test/manage",
  helpDesk: "https://help.example.test/tickets",
  billing: "https://account.example.test/manage#billing",
};

const expired: ShellNotice = {
  code: "license-expired",
  message: "Your renewal subscription has expired.",
  actionUrl: "https://account.example.test/renew",
  actionLabel: "Renew",
};

const expiresSoon: ShellNotice = {
  code: "license-expires-soon",
  message: "Your renewal subscription expires soon.",
  actionUrl: "https://account.example.test/renew",
  actionLabel: "Renew",
};

function renderShell(notices: ShellNotice[], signOutError?: string) {
  return render(
    <SurveyjsSiteShell
      user={currentUser}
      notices={notices}
      links={links}
      onSignOut={() => {}}
      signOutError={signOutError}
    >
      <p>page content</p>
    </SurveyjsSiteShell>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // The cookie banner has its own tests.
  localStorage.setItem("isInformedAboutCookieAndPolicies", "true");
});

describe("SurveyjsSiteShell", () => {
  it("renders the page between the site's header and footer", () => {
    renderShell([]);

    expect(screen.getByText("page content").closest("main")).not.toBeNull();
    const header = screen.getByRole("banner");
    // The desktop Account drop-down and the tablet Account item both show the name.
    expect(within(header).getAllByText("Olivia Owner")).toHaveLength(2);
    expect(within(header).getByRole("link", { name: "My Surveys" }).getAttribute("href")).toBe("/");
    expect(within(header).getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe(
      "https://surveyjs.io/pricing",
    );
    expect(screen.getByRole("contentinfo").textContent).toContain("Devsoft Baltic OÜ");
  });

  it("makes every drop-down of the top bar a focusable menu button", () => {
    renderShell([]);

    const triggers = within(screen.getByRole("banner")).getAllByRole("button", { expanded: false });
    const menus = triggers.filter((trigger) => trigger.getAttribute("aria-haspopup") === "menu");
    expect(menus.map((trigger) => trigger.textContent?.trim())).toEqual([
      "Products",
      "Demos",
      "Developers",
      "Industries",
      "Stay Updated",
      "Olivia Owner",
    ]);
    for (const trigger of menus) expect(trigger.tabIndex).toBe(0);
  });

  it("lists Projects in the mobile account menu; a click closes the menu and navigates", () => {
    const navigate = vi.fn();
    const { container } = render(
      <SurveyjsSiteShell
        user={currentUser}
        notices={[]}
        links={links}
        onSignOut={() => {}}
        projectsLink={{ href: "/projects", navigate }}
      >
        <p>page content</p>
      </SurveyjsSiteShell>,
    );
    const mobileAccount = () =>
      container.querySelector<HTMLElement>('[data-mobile-menu="account"]')!;

    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Account" }));
    const link = within(mobileAccount()).getByRole("link", { name: "Projects" });
    expect(link.getAttribute("href")).toBe("/projects");
    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(mobileAccount().classList.contains("v2-class---mobile-menu--opened")).toBe(false);
    expect(within(mobileAccount()).queryByRole("link", { name: "Projects" })).toBeNull();
  });

  it("shows no licence dialog without a notice", () => {
    renderShell([]);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the expired dialog with the notice's message and action link", () => {
    renderShell([expired]);

    const dialog = screen.getByRole("dialog", { name: "Your renewal subscription has expired." });
    expect(dialog.classList.contains("v2-class---banner--licences-expired")).toBe(true);
    expect(within(dialog).getByRole("link", { name: "Renew" }).getAttribute("href")).toBe(
      expired.actionUrl,
    );
    expect(within(dialog).getByRole("link", { name: "Help Desk" }).getAttribute("href")).toBe(
      links.helpDesk,
    );
  });

  it("shows the expires-soon dialog for that notice", () => {
    renderShell([expiresSoon]);

    const dialog = screen.getByRole("dialog", { name: "Your renewal subscription expires soon." });
    expect(dialog.classList.contains("v2-class---banner--licences-expires-soon")).toBe(true);
  });

  it("closes the dialog on Later and does not show it again in this browser", () => {
    const { unmount } = renderShell([expired]);

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("expiredNotificationDateTime")).not.toBeNull();
    unmount();
    renderShell([expired]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("counts Renew as a dismissal too", () => {
    renderShell([expired]);

    fireEvent.click(screen.getByRole("link", { name: "Renew" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("expiredNotificationDateTime")).not.toBeNull();
  });

  it("remembers each dialog separately", () => {
    localStorage.setItem("expiredNotificationDateTime", new Date().toUTCString());

    renderShell([expiresSoon]);

    expect(
      screen.getByRole("dialog", { name: "Your renewal subscription expires soon." }),
    ).toBeTruthy();
  });

  it("twinkles the account icon until the dialog is dismissed; Settings keeps its warning", () => {
    const { container } = renderShell([expired]);
    const twinkling = () => container.querySelector(".v2-class---top-menu-item__icon--twinkling");
    const warning = () =>
      container.querySelector(".v2-class---drop-down-menu-item--manage-warning");
    expect(twinkling()).not.toBeNull();
    expect(warning()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(twinkling()).toBeNull();
    expect(warning()).not.toBeNull();
  });

  it("shows a sign-out failure", () => {
    renderShell([], "Could not sign out. Please try again.");

    expect(screen.getByRole("alert").textContent).toContain("Could not sign out");
  });
});
