import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "@surveyjs-studio/contract/types";
import { renderApp } from "./test/renderApp";
import {
  appConfig,
  configHandler,
  currentUser,
  meHandler,
  server,
  surveyListPageHandlers,
} from "./test/server";

vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));

type AdminUser = components["schemas"]["AdminUser"];

const passwordConfig = { ...appConfig, authMethods: ["password" as const] };
const instanceAdmin = { ...currentUser, instanceRole: "admin" as const, mustChangePassword: false };
const plainUser = { ...currentUser, instanceRole: "user" as const, mustChangePassword: false };

const users: AdminUser[] = [
  {
    id: currentUser.id,
    email: currentUser.email,
    displayName: currentUser.displayName,
    instanceRole: "admin",
    status: "active",
    hasPassword: true,
    pendingLink: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    lastSignInAt: "2026-10-29T08:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "nina@example.test",
    displayName: "Nina",
    instanceRole: "user",
    status: "invited",
    hasPassword: false,
    pendingLink: { purpose: "invitation", expiresAt: "2026-11-04T09:00:00.000Z" },
    createdAt: "2026-10-28T09:00:00.000Z",
    lastSignInAt: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    email: "rex@example.test",
    displayName: "Rex",
    instanceRole: "user",
    status: "active",
    hasPassword: false,
    pendingLink: { purpose: "reset", expiresAt: "2026-11-05T09:00:00.000Z" },
    createdAt: "2026-10-20T09:00:00.000Z",
    lastSignInAt: "2026-10-27T08:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    email: "ivo@example.test",
    displayName: "Ivo",
    instanceRole: "user",
    status: "invited",
    hasPassword: false,
    pendingLink: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    lastSignInAt: null,
  },
];

/** Nina's linked sign-ins; the subject of the Google one needs URL-encoding. */
const ninasSignIns = [
  {
    provider: "github" as const,
    subject: "583231",
    email: "nina@example.test",
    linkedAt: "2026-10-30T08:00:00.000Z",
  },
  {
    provider: "google" as const,
    subject: "g/1 2",
    email: null,
    linkedAt: "2026-11-01T08:00:00.000Z",
  },
];

const link = {
  url: "http://localhost:5173/set-password?token=7cJ2rQ0wUu8xXnYk3fVb1A",
  expiresAt: "2026-11-05T10:00:00.000Z",
};

/** The admin API on the test server, keeping each request's method, path and body. */
function adminHandlers() {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const keep = async (request: Request) => {
    const text = await request.text();
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname.replace("/api/v1", ""),
      body: text ? (JSON.parse(text) as unknown) : null,
    });
  };
  const handlers = [
    mswHttp.get("*/api/v1/admin/users", () =>
      HttpResponse.json({ items: users, nextCursor: null }),
    ),
    mswHttp.post("*/api/v1/admin/users", async ({ request }) => {
      await keep(request);
      return HttpResponse.json(
        {
          user: {
            ...users[1]!,
            id: "00000000-0000-4000-8000-000000000003",
            email: "new@example.test",
            displayName: "New",
          },
          link,
        },
        { status: 201 },
      );
    }),
    mswHttp.patch("*/api/v1/admin/users/:userId", async ({ request }) => {
      await keep(request);
      return HttpResponse.json({ ...users[1]!, status: "disabled" });
    }),
    mswHttp.delete("*/api/v1/admin/users/:userId", async ({ request }) => {
      await keep(request);
      return new HttpResponse(null, { status: 204 });
    }),
    mswHttp.post("*/api/v1/admin/users/:userId/reset-link", async ({ request }) => {
      await keep(request);
      return HttpResponse.json(link, { status: 201 });
    }),
    mswHttp.get("*/api/v1/admin/users/:userId/identities", ({ params }) =>
      HttpResponse.json({ items: params.userId === users[1]!.id ? ninasSignIns : [] }),
    ),
    mswHttp.delete(
      "*/api/v1/admin/users/:userId/identities/:provider/:subject",
      async ({ request }) => {
        // The path as sent, still encoded.
        requests.push({
          method: request.method,
          path: new URL(request.url).pathname.replace("/api/v1", ""),
          body: null,
        });
        return new HttpResponse(null, { status: 204 });
      },
    ),
  ];
  return { handlers, requests };
}

beforeEach(() => {
  server.use(...surveyListPageHandlers());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Users page", () => {
  it("is linked from the shell for an instance admin only", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      ...adminHandlers().handlers,
    );
    renderApp("/");
    fireEvent.click(await screen.findByRole("link", { name: "Users" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Users" })).toBeTruthy();
  });

  it("has no link, and says so, for a user who is not an instance admin", async () => {
    server.use(configHandler(passwordConfig), meHandler(plainUser));
    renderApp("/admin/users");
    expect(await screen.findByText("Only instance admins can manage users.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the users with their role, status and last sign-in", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      ...adminHandlers().handlers,
    );
    renderApp("/admin/users");
    const nina = await screen.findByRole("row", { name: /Nina/ });
    expect(within(nina).getByText("nina@example.test")).toBeTruthy();
    expect(within(nina).getByText("Invited")).toBeTruthy();
    expect(within(nina).getByText("Never")).toBeTruthy();
    const me = screen.getByRole("row", { name: /Olivia Owner/ });
    expect(within(me).getByText("Admin")).toBeTruthy();
    expect(within(me).getByText("Active")).toBeTruthy();
    // A reset user whose link waits, and an invitation that expired: not just Active, Invited.
    const rex = screen.getByRole("row", { name: /Rex/ });
    expect(within(rex).getByText("Reset pending")).toBeTruthy();
    const ivo = screen.getByRole("row", { name: /Ivo/ });
    expect(within(ivo).getByText("Invited, link expired")).toBeTruthy();
  });

  it("shows a user's sign-ins, and unlinks one after a confirmation", async () => {
    const { handlers, requests } = adminHandlers();
    server.use(configHandler(passwordConfig), meHandler(instanceAdmin), ...handlers);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/admin/users");

    const nina = await screen.findByRole("row", { name: /Nina/ });
    const toggle = within(nina).getByRole("button", { name: "Sign-ins" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const signIns = document.getElementById(toggle.getAttribute("aria-controls") ?? "")!;
    expect(await within(signIns).findByText("GitHub")).toBeTruthy();
    expect(signIns.textContent).toContain("No password");
    expect(signIns.textContent).toContain("nina@example.test, linked Oct 30, 2026");
    expect(signIns.textContent).toContain("Google, linked Nov 1, 2026");

    fireEvent.click(within(signIns).getByRole("button", { name: "Unlink Google" }));
    expect(confirm).toHaveBeenCalledWith(
      "Unlink the Google sign-in of Nina? It no longer signs in to their account, and they are signed out. If Google still gives their email as verified, signing in with it links it again: to keep them out, disable them.",
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      method: "DELETE",
      path: `/admin/users/${users[1]!.id}/identities/google/g%2F1%202`,
      body: null,
    });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("says when a user has no linked sign-in", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      ...adminHandlers().handlers,
    );
    renderApp("/admin/users");
    const me = await screen.findByRole("row", { name: /Olivia Owner/ });
    fireEvent.click(within(me).getByRole("button", { name: "Sign-ins" }));
    expect(
      await screen.findByText("No linked Google, GitHub, Facebook or SurveyJS sign-in"),
    ).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
  });

  it("warns about your own row: delete, disable and unlink sign you out; no own reset", async () => {
    const { handlers, requests } = adminHandlers();
    server.use(configHandler(passwordConfig), meHandler(instanceAdmin), ...handlers);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/admin/users");

    const me = await screen.findByRole("row", { name: /Olivia Owner/ });
    fireEvent.click(within(me).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(me).getByRole("button", { name: "Disable" }));
    fireEvent.click(within(me).getByRole("button", { name: "Make user" }));
    expect(confirm.mock.calls.map(([question]) => question)).toEqual([
      "Delete your own account? Your personal surveys and results are erased, you leave every project, and you are signed out at once. You can't undo this.",
      "Disable your own account? You are signed out at once and cannot sign in until another admin enables you.",
      "Make yourself a user? You can no longer manage users and every project, and you leave this page.",
    ]);
    // The server refuses an admin's own reset, so the button is off.
    const reset = within(me).getByRole("button", { name: "Reset password" });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(reset.title).toBe("Change your own password in your account.");
    expect(requests).toEqual([]);
  });

  it("disables a row's buttons while its request runs, and sends it once", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const patches: string[] = [];
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      mswHttp.patch("*/api/v1/admin/users/:userId", async ({ params }) => {
        patches.push(String(params.userId));
        await held;
        return HttpResponse.json({ ...users[1]!, status: "disabled" });
      }),
      ...adminHandlers().handlers,
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/admin/users");

    const nina = await screen.findByRole("row", { name: /Nina/ });
    const disable = within(nina).getByRole("button", { name: "Disable" });
    fireEvent.click(disable);
    fireEvent.click(disable);
    await waitFor(() => expect((disable as HTMLButtonElement).disabled).toBe(true));
    for (const name of ["Make admin", "Reset password", "Delete"]) {
      expect((within(nina).getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    // Another row is not held up.
    const rex = screen.getByRole("row", { name: /Rex/ });
    expect(
      (within(rex).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    release();
    await waitFor(() => expect((disable as HTMLButtonElement).disabled).toBe(false));
    expect(patches).toEqual([users[1]!.id]);
  });

  it("selects the link to copy by hand where the page may not copy it (plain HTTP)", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      ...adminHandlers().handlers,
    );
    // Outside a secure context there is no clipboard.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/admin/users");

    const nina = await screen.findByRole("row", { name: /Nina/ });
    fireEvent.click(within(nina).getByRole("button", { name: "Reset password" }));
    const shown = await screen.findByRole("status");
    fireEvent.click(within(shown).getByRole("button", { name: "Copy link" }));
    expect(
      await within(shown).findByText(/The link is selected: press Ctrl\+C, or ⌘C on a Mac/),
    ).toBeTruthy();
    const input = within(shown).getByLabelText<HTMLInputElement>("Set-password link");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.url.length);
    expect(within(shown).queryByText("Copied.")).toBeNull();
  });

  it("creates a user and shows the link once, with a copy button", async () => {
    const { handlers, requests } = adminHandlers();
    server.use(configHandler(passwordConfig), meHandler(instanceAdmin), ...handlers);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp("/admin/users");

    await screen.findByRole("heading", { level: 1, name: "Users" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.click(screen.getByLabelText("Instance admin"));
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    const shown = await screen.findByRole("status");
    expect(within(shown).getByDisplayValue(link.url)).toBeTruthy();
    expect(shown.textContent).toContain("only now");
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/admin/users",
        body: { email: "new@example.test", displayName: "New", instanceRole: "admin" },
      },
    ]);
    fireEvent.click(within(shown).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(link.url);
    expect(await within(shown).findByText("Copied.")).toBeTruthy();

    fireEvent.click(within(shown).getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue(link.url)).toBeNull();
  });

  it("asks before a row action, and does nothing when the admin cancels", async () => {
    const { handlers, requests } = adminHandlers();
    server.use(configHandler(passwordConfig), meHandler(instanceAdmin), ...handlers);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/admin/users");

    const nina = await screen.findByRole("row", { name: /Nina/ });
    fireEvent.click(within(nina).getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith(
      "Delete Nina? Their personal surveys and results are erased, and they leave every project.",
    );
    fireEvent.click(within(nina).getByRole("button", { name: "Reset password" }));
    expect(confirm).toHaveBeenLastCalledWith(
      "Reset the password of Nina? Their password and linked sign-ins stop working, they are signed out, and you get a new link for them.",
    );
    expect(requests).toEqual([]);
  });

  it("disables, resets and deletes a user after confirmation", async () => {
    const { handlers, requests } = adminHandlers();
    server.use(configHandler(passwordConfig), meHandler(instanceAdmin), ...handlers);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/admin/users");

    const nina = await screen.findByRole("row", { name: /Nina/ });
    fireEvent.click(within(nina).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(within(nina).getByRole("button", { name: "Reset password" }));
    expect(within(await screen.findByRole("status")).getByDisplayValue(link.url)).toBeTruthy();
    fireEvent.click(within(nina).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["PATCH", `/admin/users/${users[1]!.id}`, { status: "disabled" }],
      ["POST", `/admin/users/${users[1]!.id}/reset-link`, null],
      ["DELETE", `/admin/users/${users[1]!.id}`, null],
    ]);
  });

  it("shows the server's refusal of the last admin's demotion", async () => {
    // The refusal comes first: of the handlers in one call, the first that matches answers.
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      mswHttp.patch("*/api/v1/admin/users/:userId", () =>
        HttpResponse.json(
          {
            type: "https://studio.surveyjs.io/problems/last-instance-admin",
            title: "Last instance admin",
            status: 409,
            code: "last-instance-admin",
            detail: "The instance must keep at least one active admin.",
          },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
      ...adminHandlers().handlers,
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/admin/users");

    const me = await screen.findByRole("row", { name: /Olivia Owner/ });
    fireEvent.click(within(me).getByRole("button", { name: "Make user" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The instance must keep at least one active admin.",
    );
  });
});

describe("the Projects page of an instance admin", () => {
  it("lists every project of the instance", async () => {
    const scopes: (string | null)[] = [];
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      mswHttp.get("*/api/v1/projects", ({ request }) => {
        scopes.push(new URL(request.url).searchParams.get("scope"));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderApp("/projects");
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(scopes).toContain("all");
  });
});

describe("an instance admin deleting a project on the Projects page", () => {
  it("removes its card once the server deleted it", async () => {
    let projects = [
      {
        id: "55555555-0000-4000-8000-000000000009",
        name: "Not my project",
        ownerId: null,
        role: "admin" as const,
        memberCount: 1,
        createdAt: "2026-10-01T09:00:00.000Z",
      },
    ];
    server.use(
      configHandler(passwordConfig),
      meHandler(instanceAdmin),
      mswHttp.get("*/api/v1/projects", () =>
        HttpResponse.json({ items: projects, nextCursor: null }),
      ),
      mswHttp.delete("*/api/v1/projects/:projectId", () => {
        projects = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/projects");

    expect(await screen.findByText("Not my project")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("link", { name: "Remove" })[0]!);
    await waitFor(() => expect(screen.queryByText("Not my project")).toBeNull());
  });
});
