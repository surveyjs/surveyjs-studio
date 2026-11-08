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
    createdAt: "2026-10-01T09:00:00.000Z",
    lastSignInAt: "2026-10-29T08:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "nina@example.test",
    displayName: "Nina",
    instanceRole: "user",
    status: "invited",
    createdAt: "2026-10-28T09:00:00.000Z",
    lastSignInAt: null,
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
