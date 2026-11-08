import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../navigation";
import { AccountPicker } from "./AccountPicker";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";

vi.mock("../navigation", () => ({ navigateTo: vi.fn() }));

const seed = seedJson as unknown as SandboxSeed;
const [olivia, adam, mia, oscar] = seed.users;

function renderPicker(returnTo?: string) {
  render(
    <AccountPicker
      users={seed.users}
      projects={seed.projects}
      memberships={seed.memberships}
      returnTo={returnTo}
    />,
  );
}

beforeEach(() => vi.mocked(navigateTo).mockClear());
afterEach(() => {
  document.cookie = "msid=; path=/; max-age=0";
});

describe("AccountPicker", () => {
  it("lists the four seed users with their projects and roles", () => {
    renderPicker();

    expect(screen.getByRole("heading", { name: "Pick an account" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const button = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
    expect(within(button("Olivia Owner")).getByText("owner@example.com")).toBeTruthy();
    expect(button("Olivia Owner").textContent).toContain("Marketing: admin");
    expect(button("Olivia Owner").textContent).toContain("Engineering: user");
    expect(button("Adam Admin").textContent).toContain("Engineering: admin");
    expect(button("Mia Member").textContent).toContain("Marketing: user");
    expect(button("Oscar Outsider").textContent).toContain("No projects");
  });

  it("sets the session cookie and goes to My Surveys", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /Mia Member/ }));

    expect(document.cookie).toContain(`msid=${mia!.id}`);
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("goes to the returnTo path of this app", () => {
    renderPicker("/projects?x=1");

    fireEvent.click(screen.getByRole("button", { name: /Adam Admin/ }));

    expect(document.cookie).toContain(`msid=${adam!.id}`);
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/projects?x=1");
  });

  it("ignores a returnTo that leaves the app", () => {
    renderPicker("https://evil.example/x");

    fireEvent.click(screen.getByRole("button", { name: /Oscar Outsider/ }));

    expect(document.cookie).toContain(`msid=${oscar!.id}`);
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/");
    expect(olivia).toBeTruthy();
  });
});
