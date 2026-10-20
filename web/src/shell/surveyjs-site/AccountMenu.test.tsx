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

  describe("Projects", () => {
    function renderWithProjects() {
      const navigate = vi.fn();
      renderMenu({ projectsLink: { href: "/projects", navigate } });
      return { navigate, link: screen.getByRole("link", { name: "Projects" }) };
    }

    it("follows Settings and links to the app's Projects page", () => {
      const { link } = renderWithProjects();

      expect(link.getAttribute("href")).toBe("/projects");
      expect(link.getAttribute("target")).toBeNull();
      const items = screen.getByRole("navigation").querySelectorAll("a");
      const names = Array.from(items, (item) => item.textContent.trim());
      expect(names).toEqual(["Settings", "Projects", "Help Desk", "Billing", "Sign Out"]);
    });

    it("closes the drop-down after the click, though the pointer is still over it", () => {
      const { link } = renderWithProjects();
      const item = screen.getByRole("listitem", { name: "Account" });
      const trigger = within(item).getByRole("button", { name: /Olivia Owner/ });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      fireEvent.mouseEnter(item);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(link);

      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(item.className).toMatch(/dropDownDismissed/);

      fireEvent.mouseLeave(item);
      expect(item.className).not.toMatch(/dropDownDismissed/);
    });

    it("navigates in the app on a plain click instead of loading the page", () => {
      const { navigate, link } = renderWithProjects();

      const notPrevented = fireEvent.click(link);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(notPrevented).toBe(false);
    });

    it("leaves a ctrl-click or a middle click to the browser", () => {
      const { navigate, link } = renderWithProjects();
      // Records whether the app prevented the default, then stops jsdom from following the link.
      const prevented: boolean[] = [];
      const record = (event: Event) => {
        prevented.push(event.defaultPrevented);
        event.preventDefault();
      };
      document.addEventListener("click", record);
      try {
        fireEvent.click(link, { ctrlKey: true });
        fireEvent.click(link, { button: 1 });
      } finally {
        document.removeEventListener("click", record);
      }

      expect(prevented).toEqual([false, false]);
      expect(navigate).not.toHaveBeenCalled();
    });

    it("is left out without a link", () => {
      renderMenu();

      expect(screen.queryByRole("link", { name: "Projects" })).toBeNull();
    });
  });

  describe("keyboard", () => {
    const trigger = () => screen.getByRole("button", { name: "Olivia Owner" });

    it("has a focusable trigger that announces a closed menu", () => {
      renderMenu();

      expect(trigger().tabIndex).toBe(0);
      expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      const menu = document.getElementById(trigger().getAttribute("aria-controls") ?? "");
      expect(menu?.querySelector("a")?.textContent).toBe("Settings");
    });

    it("opens with Enter and closes with Escape, back on the trigger", () => {
      const { container } = renderMenu();
      trigger().focus();

      fireEvent.keyDown(trigger(), { key: "Enter" });
      expect(trigger().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("listitem", { name: "Account" }).className).toMatch(/dropDownOpen/);

      const signOut = screen.getByRole("button", { name: "Sign Out" });
      signOut.focus();
      fireEvent.keyDown(signOut, { key: "Escape" });
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger());
      expect(container.querySelector("[class*=dropDownOpen]")).toBeNull();
    });

    it("opens with Space or ArrowDown, and closes when focus leaves the item", () => {
      render(
        <>
          <ul>
            <AccountMenu user={currentUser} links={links} onSignOut={() => {}} />
          </ul>
          <button type="button">elsewhere</button>
        </>,
      );
      fireEvent.keyDown(trigger(), { key: " " });
      expect(trigger().getAttribute("aria-expanded")).toBe("true");
      fireEvent.keyDown(trigger(), { key: " " });
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
      expect(trigger().getAttribute("aria-expanded")).toBe("true");

      fireEvent.blur(trigger(), {
        relatedTarget: screen.getByRole("button", { name: "elsewhere" }),
      });

      expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });
  });
});
