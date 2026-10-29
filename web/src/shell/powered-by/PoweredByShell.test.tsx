import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUser } from "../../test/server";
import type { ShellBranding } from "../types";
import { PoweredByFooter, PoweredByFrame, PoweredByShell } from "./PoweredByShell";

const branding: ShellBranding = {
  name: "Acme Surveys",
  logoUrl: "/brand/logo.svg",
  accentColor: "#0a7",
  termsUrl: "https://acme.example/terms",
  privacyUrl: "https://acme.example/privacy",
  poweredBy: true,
};

function renderShell(overrides: Partial<Parameters<typeof PoweredByShell>[0]> = {}) {
  const onSignOut = vi.fn();
  render(
    <PoweredByShell
      user={currentUser}
      notices={[]}
      links={{}}
      onSignOut={onSignOut}
      branding={branding}
      {...overrides}
    >
      <p>page content</p>
    </PoweredByShell>,
  );
  return { onSignOut };
}

describe("PoweredByShell", () => {
  it("shows the instance's logo and name in the header, the page, and the footer", () => {
    renderShell();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("img", { name: "Acme Surveys" }).getAttribute("src")).toBe(
      "/brand/logo.svg",
    );
    expect(within(header).getByText("Acme Surveys")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Powered by SurveyJS" })).toBeTruthy();
    expect(within(footer).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(
      "https://acme.example/terms",
    );
    expect(within(footer).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe(
      "https://acme.example/privacy",
    );
  });

  it("sets the accent colour as a CSS custom property", () => {
    const { container } = render(
      <PoweredByFrame branding={branding}>
        <p>page</p>
      </PoweredByFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.style.getPropertyValue("--brand-accent")).toBe("#0a7");
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

    expect(screen.queryByRole("link", { name: "Powered by SurveyJS" })).toBeNull();
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

describe("PoweredByFooter", () => {
  it("is the footer alone, for a page without the shell (the run page)", () => {
    render(<PoweredByFooter branding={branding} />);

    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Powered by SurveyJS" })).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders nothing with the branding off and no links", () => {
    const { container } = render(
      <PoweredByFooter
        branding={{ ...branding, poweredBy: false, termsUrl: null, privacyUrl: null }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
