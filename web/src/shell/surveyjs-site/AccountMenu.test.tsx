import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUser } from "../../test/server";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

const links = {
  settings: "https://account.example.test/manage",
  helpDesk: "https://help.example.test/tickets",
  billing: "https://account.example.test/manage#billing",
};

function renderMenu(props: Partial<AccountMenuProps> = {}) {
  const onSignOut = vi.fn();
  const { container } = render(
    <ul>
      <AccountMenu user={currentUser} links={links} onSignOut={onSignOut} {...props} />
    </ul>,
  );
  return { container, onSignOut };
}

describe("AccountMenu", () => {
  it("shows the user's name with the site's account icon when there is no avatar", () => {
    renderMenu();

    const item = screen.getByRole("listitem", { name: "Account" });
    expect(within(item).getByText("Olivia Owner")).toBeTruthy();
    expect(item.querySelector("img")).toBeNull();
    expect(item.querySelector(".v2-class---top-menu-item__icon svg")).not.toBeNull();
  });

  it("shows the avatar when the user has one", () => {
    renderMenu({ user: { ...currentUser, avatarUrl: "https://idp.example.test/olivia.png" } });

    const item = screen.getByRole("listitem", { name: "Account" });
    expect(item.querySelector("img")?.getAttribute("src")).toBe(
      "https://idp.example.test/olivia.png",
    );
  });

  it("lists Settings, Help Desk and Billing with the configured links, then Sign Out", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      links.settings,
    );
    expect(screen.getByRole("link", { name: "Help Desk" }).getAttribute("href")).toBe(
      links.helpDesk,
    );
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe(links.billing);
    const items = screen.getByRole("navigation").querySelectorAll("a");
    const names = Array.from(items, (item) => item.textContent.trim());
    expect(names).toEqual(["Settings", "Help Desk", "Billing", "Sign Out"]);
  });

  it("opens Help Desk in a new tab, as the site does for an outside link", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: "Help Desk" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("target")).toBeNull();
  });

  it("calls onSignOut when Sign Out is clicked", () => {
    const { onSignOut } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("ignores Sign Out while signing out", () => {
    const { onSignOut } = renderMenu({ signingOut: true });

    const signOut = screen.getByRole("button", { name: "Sign Out" });
    fireEvent.click(signOut);

    expect(onSignOut).not.toHaveBeenCalled();
    expect(signOut.getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves out an item whose link is not configured", () => {
    renderMenu({ links: { settings: links.settings } });

    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Help Desk" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
  });

  it("renders the name as text, not markup", () => {
    const { container } = renderMenu({
      user: { ...currentUser, displayName: "<b>Bold</b> Name" },
    });

    expect(screen.getByText("<b>Bold</b> Name")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });

  it("marks Settings with the licence warning when asked", () => {
    const { container } = renderMenu({ licenceWarning: true });

    expect(
      container.querySelector(".v2-class---drop-down-menu-item--manage-warning"),
    ).not.toBeNull();
  });
});
