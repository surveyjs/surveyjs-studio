import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { COOKIE_CONSENT_KEY, CookieBanner } from "./CookieBanner";

beforeEach(() => localStorage.clear());

const banner = () => screen.queryByRole("region", { name: "Your cookie settings" });

describe("CookieBanner", () => {
  it("is shown while the visitor has not accepted cookies", () => {
    render(<CookieBanner />);

    expect(banner()).not.toBeNull();
    expect(screen.getByRole("link", { name: "Terms of Use and Privacy Statement" })).toBeTruthy();
  });

  it("hides on Accept All and remembers the choice the way the site does", () => {
    const { unmount } = render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(banner()).toBeNull();
    expect(localStorage.getItem(COOKIE_CONSENT_KEY)).toBe("true");
    unmount();
    render(<CookieBanner />);
    expect(banner()).toBeNull();
  });

  it("is not shown once the choice is stored", () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "true");

    render(<CookieBanner />);

    expect(banner()).toBeNull();
  });

  it("opens the cookie settings instead of the banner; closing them brings the banner back", () => {
    render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Cookie Settings" }));
    expect(banner()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Privacy Overview" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(banner()).not.toBeNull();
  });

  it("accepts on Confirm My Choices in the settings, as on the site", () => {
    render(<CookieBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Cookie Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm My Choices" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(banner()).toBeNull();
    expect(localStorage.getItem(COOKIE_CONSENT_KEY)).toBe("true");
  });
});
