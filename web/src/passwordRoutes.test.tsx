import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "./navigation";
import { renderApp } from "./test/renderApp";
import {
  appConfig,
  configHandler,
  currentUser,
  meHandler,
  server,
  surveyListPageHandlers,
  unauthenticatedHandler,
} from "./test/server";

vi.mock("./navigation", () => ({ navigateTo: vi.fn() }));

const passwordConfig = { ...appConfig, authMethods: ["password" as const] };

function problem(
  status: number,
  code: string,
  detail: string,
  headers: Record<string, string> = {},
) {
  return HttpResponse.json(
    { type: `https://studio.surveyjs.io/problems/${code}`, title: code, status, code, detail },
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

/** Answers the operation with `answer`, keeping each request body in `bodies`. */
function postHandler(
  path: string,
  answer: () => Response = () => new HttpResponse(null, { status: 204 }),
) {
  const bodies: unknown[] = [];
  const handler = mswHttp.post(`*/api/v1${path}`, async ({ request }) => {
    bodies.push(await request.json());
    return answer();
  });
  return { handler, bodies };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.mocked(navigateTo).mockClear();
  server.use(...surveyListPageHandlers());
});

describe("sign-in page", () => {
  it("signs in with the email and password, then goes back to returnTo", async () => {
    const login = postHandler("/auth/password/login");
    server.use(configHandler(passwordConfig), login.handler);

    renderApp(`/sign-in?returnTo=${encodeURIComponent("/projects?x=1")}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    type("Email", "owner@example.test");
    type("Password", "a long password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/projects?x=1"));
    expect(login.bodies).toEqual([{ email: "owner@example.test", password: "a long password" }]);
  });

  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example"])(
    "goes to My Surveys instead of a returnTo outside the app (%s)",
    async (returnTo) => {
      server.use(configHandler(passwordConfig), postHandler("/auth/password/login").handler);

      renderApp(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);

      await screen.findByRole("heading", { level: 1, name: "Sign in" });
      type("Email", "owner@example.test");
      type("Password", "a long password");
      fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/"));
    },
  );

  it("shows the server's message for wrong credentials and for a lockout", async () => {
    let answer = () => problem(401, "invalid-credentials", "The email or the password is wrong.");
    server.use(
      configHandler(passwordConfig),
      postHandler("/auth/password/login", () => answer()).handler,
    );

    renderApp("/sign-in");

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    type("Email", "owner@example.test");
    type("Password", "a wrong password");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The email or the password is wrong.",
    );

    answer = () =>
      problem(429, "account-locked", "Too many failed attempts. Try again in 1 minute(s).", {
        "Retry-After": "60",
      });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Too many failed attempts. Try again in 1 minute(s).",
      ),
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("offers the SurveyJS sign-in too when it is configured", async () => {
    server.use(configHandler({ ...appConfig, authMethods: ["surveyjs", "password"] }));

    renderApp(`/sign-in?returnTo=${encodeURIComponent("/projects")}`);

    const link = await screen.findByRole("link", { name: "Sign in with SurveyJS" });
    expect(link.getAttribute("href")).toBe(
      `/api/v1/auth/login?returnTo=${encodeURIComponent("/projects")}`,
    );
  });

  it("has no SurveyJS button with passwords only", async () => {
    server.use(configHandler(passwordConfig));

    renderApp("/sign-in");

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(screen.queryByRole("link", { name: "Sign in with SurveyJS" })).toBeNull();
  });
});

describe("private route guard with passwords", () => {
  it("sends a signed-out visitor to the sign-in page in the app", async () => {
    server.use(configHandler(passwordConfig), unauthenticatedHandler());

    const router = renderApp("/projects?tab=1");

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toEqual({ returnTo: "/projects?tab=1" });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("sends a user who must change the password to the change-password page first", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler({ ...currentUser, mustChangePassword: true }),
    );

    const router = renderApp("/projects");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Change your password" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/change-password");
    expect(router.state.location.search).toEqual({ returnTo: "/projects" });
    expect(screen.getByText(/must choose a new password/)).toBeTruthy();
  });

  it("lets a user who need not change the password through", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler({ ...currentUser, mustChangePassword: false }),
    );

    renderApp("/");

    expect(await screen.findByRole("heading", { level: 1, name: "My Surveys" })).toBeTruthy();
  });

  it("links the shell to the change-password page", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler({ ...currentUser, mustChangePassword: false }),
    );

    const router = renderApp("/");

    fireEvent.click(await screen.findByRole("link", { name: "Change password" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Change your password" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/change-password");
    expect(screen.queryByText(/must choose a new password/)).toBeNull();
  });

  it("has no change-password link without passwords", async () => {
    server.use(configHandler(), meHandler());

    renderApp("/");

    await screen.findByRole("heading", { level: 1, name: "My Surveys" });
    expect(screen.queryByRole("link", { name: "Change password" })).toBeNull();
  });
});

describe("change-password page", () => {
  it("changes the password, then reloads at returnTo with the new session", async () => {
    const change = postHandler("/me/password");
    server.use(
      configHandler(passwordConfig),
      meHandler({ ...currentUser, mustChangePassword: true }),
      change.handler,
    );

    renderApp("/projects");

    await screen.findByRole("heading", { level: 1, name: "Change your password" });
    type("Current password", "first admin password");
    type("New password", "a brand new password");
    type("Repeat the new password", "a brand new password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/projects"));
    expect(change.bodies).toEqual([
      { currentPassword: "first admin password", newPassword: "a brand new password" },
    ]);
  });

  it("refuses two different new passwords without asking the server", async () => {
    const change = postHandler("/me/password");
    server.use(configHandler(passwordConfig), meHandler(), change.handler);

    renderApp("/change-password");

    await screen.findByRole("heading", { level: 1, name: "Change your password" });
    type("Current password", "first admin password");
    type("New password", "a brand new password");
    type("Repeat the new password", "a brand new passwort");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The new passwords do not match.");
    expect(change.bodies).toEqual([]);
  });

  it("shows the server's message for a weak password", async () => {
    server.use(
      configHandler(passwordConfig),
      meHandler(),
      postHandler("/me/password", () =>
        problem(422, "password-too-weak", "This password is too common. Choose another one."),
      ).handler,
    );

    renderApp("/change-password");

    await screen.findByRole("heading", { level: 1, name: "Change your password" });
    type("Current password", "first admin password");
    type("New password", "password1234");
    type("Repeat the new password", "password1234");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This password is too common. Choose another one.",
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe("set-password page", () => {
  it("creates the first admin from the setup link", async () => {
    const link = postHandler("/auth/password-link");
    server.use(configHandler(passwordConfig), link.handler);

    renderApp("/set-password?setup=setup-token");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create the first admin" }),
    ).toBeTruthy();
    type("Email", "owner@example.test");
    type("Name", "Olivia Owner");
    type("Password", "a long password");
    type("Repeat the password", "a long password");
    fireEvent.click(screen.getByRole("button", { name: "Create the admin" }));

    expect(await screen.findByText(/The admin was created/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(link.bodies).toEqual([
      {
        token: "setup-token",
        password: "a long password",
        email: "owner@example.test",
        displayName: "Olivia Owner",
      },
    ]);
  });

  it("sets the password from a set-password link", async () => {
    const link = postHandler("/auth/password-link");
    server.use(configHandler(passwordConfig), link.handler);

    renderApp("/set-password?token=link-token");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Set your password" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    type("Password", "a long password");
    type("Repeat the password", "a long password");
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText(/Your password was set/)).toBeTruthy();
    expect(link.bodies).toEqual([{ token: "link-token", password: "a long password" }]);
  });

  it("shows the server's message for a used link", async () => {
    server.use(
      configHandler(passwordConfig),
      postHandler("/auth/password-link", () =>
        problem(
          400,
          "link-invalid",
          "This link was used already, has expired, or is not a link of this site.",
        ),
      ).handler,
    );

    renderApp("/set-password?token=used-token");

    await screen.findByRole("heading", { level: 1, name: "Set your password" });
    type("Password", "a long password");
    type("Repeat the password", "a long password");
    fireEvent.click(await screen.findByRole("button", { name: "Set password" }));

    expect((await screen.findByRole("alert")).textContent).toContain("used already");
  });

  it("says the link is incomplete without a token", async () => {
    server.use(configHandler(passwordConfig));

    renderApp("/set-password");

    expect(await screen.findByText(/This link is not complete/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
