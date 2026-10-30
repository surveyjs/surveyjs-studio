import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../../test/renderApp";
import {
  appConfig,
  configHandler,
  currentUser,
  meHandler,
  server,
  unauthenticatedHandler,
} from "../../test/server";
import type { ShellBranding } from "../types";
import { SelfHostedFooter, SelfHostedFrame, SelfHostedShell } from "./SelfHostedShell";

const branding: ShellBranding = {
  name: "Acme Surveys",
  logoUrl: "/brand/logo.svg",
  accentColor: "#0a7",
  termsUrl: "https://acme.example/terms",
  privacyUrl: "https://acme.example/privacy",
  poweredBy: true,
};

const POWERED_BY = "Powered by SurveyJS (opens in a new tab)";

function renderShell(overrides: Partial<Parameters<typeof SelfHostedShell>[0]> = {}) {
  const onSignOut = vi.fn();
  render(
    <SelfHostedShell
      user={currentUser}
      notices={[]}
      links={{}}
      onSignOut={onSignOut}
      branding={branding}
      {...overrides}
    >
      <p>page content</p>
    </SelfHostedShell>,
  );
  return { onSignOut };
}

describe("SelfHostedShell", () => {
  it("shows the instance's logo and name in the header, the page, and the footer", () => {
    renderShell();

    const header = screen.getByRole("banner");
    expect(header.querySelector("img")!.getAttribute("src")).toBe("/brand/logo.svg");
    expect(within(header).getByText("Acme Surveys")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: POWERED_BY })).toBeTruthy();
    expect(within(footer).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(
      "https://acme.example/terms",
    );
    expect(within(footer).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe(
      "https://acme.example/privacy",
    );
  });

  it("keeps the visible text of the Powered by SurveyJS link, and says it opens a new tab", () => {
    renderShell();

    const link = screen.getByRole("link", { name: POWERED_BY });
    expect(link.firstChild!.textContent!.trim()).toBe("Powered by SurveyJS");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("sets the tab title to the instance's name; a page's own title still wins", () => {
    document.title = "";
    render(
      <SelfHostedFrame branding={branding}>
        <p>page</p>
      </SelfHostedFrame>,
    );
    expect(document.title).toBe("Acme Surveys");

    function Titled() {
      useEffect(() => {
        document.title = "Customer feedback";
      }, []);
      return <p>run</p>;
    }
    render(
      <SelfHostedFrame branding={branding}>
        <Titled />
      </SelfHostedFrame>,
    );
    expect(document.title).toBe("Customer feedback");
  });

  it("links the instance's name to My Surveys, and lists My Surveys first", () => {
    const navigate = vi.fn();
    renderShell({ homeLink: { href: "/", navigate } });

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Acme Surveys" }).getAttribute("href")).toBe(
      "/",
    );
    expect(within(header).getByRole("link", { name: "My Surveys" }).getAttribute("href")).toBe("/");
    fireEvent.click(within(header).getByRole("link", { name: "My Surveys" }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("gives the logo no text of its own: the name next to it says it", () => {
    renderShell();
    expect(screen.getByRole("banner").querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("sets the accent colour as a CSS custom property", () => {
    const { container } = render(
      <SelfHostedFrame branding={branding}>
        <p>page</p>
      </SelfHostedFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.style.getPropertyValue("--sh-accent")).toBe("#0a7");
    // Text in the accent colour uses a shade that reads on white.
    expect(frame.style.getPropertyValue("--sh-accent-text")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("can leave the main landmark to a page that has its own", () => {
    render(
      <SelfHostedFrame branding={branding} ownMain>
        <main>page</main>
      </SelfHostedFrame>,
    );
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("has the user's links and Sign Out in the header", () => {
    const navigate = vi.fn();
    const { onSignOut } = renderShell({
      projectsLink: { href: "/projects", navigate },
      usersLink: { href: "/admin/users", navigate },
      changePasswordLink: { href: "/change-password", navigate },
    });

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Olivia Owner")).toBeTruthy();
    for (const [name, href] of [
      ["Projects", "/projects"],
      ["Users", "/admin/users"],
      ["Change password", "/change-password"],
    ]) {
      expect(within(header).getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
    fireEvent.click(within(header).getByRole("link", { name: "Users" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    fireEvent.click(within(header).getByRole("button", { name: "Sign Out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("leaves out what is not configured", () => {
    renderShell({ branding: { ...branding, logoUrl: null, termsUrl: null, privacyUrl: null } });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Terms" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  });

  it("hides Powered by SurveyJS when the branding is off", () => {
    renderShell({ branding: { ...branding, poweredBy: false } });

    expect(screen.queryByRole("link", { name: POWERED_BY })).toBeNull();
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
  });

  it("shows notices and a sign-out error", () => {
    renderShell({
      notices: [{ code: "n", message: "A notice." }],
      signOutError: "Could not sign out. Please try again.",
    });

    expect(screen.getByRole("status").textContent).toContain("A notice.");
    expect(screen.getByRole("alert").textContent).toContain("Could not sign out");
  });
});

describe("SelfHostedFooter", () => {
  it("is the footer alone, for a page without the shell (the run page)", () => {
    render(<SelfHostedFooter branding={branding} />);

    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("link", { name: POWERED_BY })).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders nothing with the branding off and no links", () => {
    const { container } = render(
      <SelfHostedFooter
        branding={{ ...branding, poweredBy: false, termsUrl: null, privacyUrl: null }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the not-found page in the self-hosted shell", () => {
  const config = { ...appConfig, shell: "self-hosted", branding };

  it("sits in the frame of a visitor who is not signed in: the brand header and the footer", async () => {
    server.use(configHandler(config), unauthenticatedHandler());
    renderApp("/no/such/page");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(within(screen.getAllByRole("banner")[0]!).getByText("Acme Surveys")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
  });

  it("sits in the signed-in shell for a signed-in user", async () => {
    server.use(configHandler(config), meHandler());
    renderApp("/no/such/page");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(within(screen.getAllByRole("banner")[0]!).getByText("Acme Surveys")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });
});
