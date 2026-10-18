import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Member, Project } from "./api/projects";
import {
  DELETE_PROJECT_CONFIRMATION,
  LEAVE_PROJECT_CONFIRMATION,
  removeMemberConfirmation,
} from "./projects/messages";
import {
  membersHandler,
  otherMember,
  problemAnswer,
  projectWriteHandlers,
  selfMember,
  type RecordedWrite,
  type WriteAnswer,
} from "./test/project-handlers";
import { renderApp } from "./test/renderApp";
import {
  configHandler,
  currentUser,
  meHandler,
  projectsHandler,
  sampleProject,
  server,
  surveyListPageHandlers,
} from "./test/server";

const marketing = sampleProject;
const engineering: Project = {
  ...sampleProject,
  id: "55555555-0000-4000-8000-a00000000002",
  name: "Engineering",
  role: "user",
};

const INTRO =
  "Create multiple projects to group the web forms you have built with the Free Survey Tool. Add registered users to share the forms with them and edit your forms together.";

/** The server's success answer to each write. */
function success(write: RecordedWrite): WriteAnswer {
  if (write.method === "DELETE") return { status: 204 };
  const member = /\/members(\/|$)/.test(write.path);
  if (write.method === "POST") {
    return member
      ? { status: 201, body: { ...otherMember, email: "nobody@example.test" } }
      : { status: 201, body: { ...marketing, id: "55555555-0000-4000-8000-a000000000ff" } };
  }
  return member ? { status: 200, body: otherMember } : { status: 200, body: marketing };
}

let confirm: MockInstance<Window["confirm"]>;

beforeEach(() => {
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Renders `/projects` for the user's `projects` (members: the user as admin and Mia); every write is
 * recorded and answered by `answer`. Waits for the heading.
 */
async function renderProjects(
  projects: Project[] = [marketing, engineering],
  answer: (write: RecordedWrite) => WriteAnswer = success,
  members: (projectId: string) => Member[] = () => [selfMember, otherMember],
) {
  const writes: RecordedWrite[] = [];
  const projectReads: URL[] = [];
  const memberReads: URL[] = [];
  server.use(
    configHandler(),
    meHandler(),
    mswHttp.get("*/api/v1/projects", ({ request }) => {
      projectReads.push(new URL(request.url));
      return HttpResponse.json({ items: projects, nextCursor: null });
    }),
    membersHandler(members, (url) => memberReads.push(url)),
    ...projectWriteHandlers(writes, answer),
  );
  const router = renderApp("/projects");
  await screen.findByRole("heading", { level: 1, name: "Projects" });
  return { router, writes, projectReads, memberReads };
}

function card(name: string): HTMLDetailsElement {
  const title = screen.getByText(name, { selector: ".v2-class---account-page__project-title" });
  return title.closest("details")!;
}

const summary = (name: string) => within(card(name).querySelector("summary")!);

/** Opens a card by clicking its summary and waits for its members. */
async function open(name: string) {
  fireEvent.click(card(name).querySelector("summary")!);
  await within(card(name)).findByText("Mia Member");
  return within(card(name));
}

function memberRow(name: string): HTMLElement {
  return screen
    .getByText(name, { selector: ".v2-class---account-page__project-user-display-name" })
    .closest<HTMLElement>(".v2-class---account-page__project-user")!;
}

describe("the Projects page", () => {
  it("shows the heading, the intro and the user's cards with their summary links", async () => {
    const { memberReads } = await renderProjects();

    const intro = screen.getByText(
      (_, element) => element?.tagName === "P" && element.textContent === INTRO,
    );
    expect(
      within(intro).getByRole("link", { name: "the Free Survey Tool" }).getAttribute("href"),
    ).toBe("/");
    const titles = document.querySelectorAll(".v2-class---account-page__project-title");
    expect(Array.from(titles, (title) => title.textContent)).toEqual(["Marketing", "Engineering"]);
    expect(summary("Marketing").getByRole("link", { name: "Rename" })).toBeTruthy();
    expect(summary("Marketing").getByRole("link", { name: "Remove" })).toBeTruthy();
    expect(summary("Marketing").queryByRole("link", { name: "Leave Project" })).toBeNull();
    expect(summary("Engineering").getByRole("link", { name: "Leave Project" })).toBeTruthy();
    expect(summary("Engineering").queryByRole("link", { name: "Rename" })).toBeNull();
    expect(summary("Engineering").queryByRole("link", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create a Project" })).toBeTruthy();
    expect(card("Marketing").open).toBe(false);
    expect(memberReads).toEqual([]);
  });

  it("reads the members when an admin opens a card and shows the admin controls", async () => {
    const { memberReads } = await renderProjects();

    const marketingCard = await open("Marketing");

    expect(card("Marketing").open).toBe(true);
    expect(memberReads.map((url) => url.pathname)).toEqual([
      `/api/v1/projects/${marketing.id}/members`,
    ]);
    const olivia = within(memberRow("Olivia Owner"));
    const mia = within(memberRow("Mia Member"));
    expect(olivia.getByText("Admin")).toBeTruthy();
    expect(mia.queryByText("Admin")).toBeNull();
    expect(mia.getByRole("link", { name: "Make Admin" })).toBeTruthy();
    expect(olivia.getByRole("link", { name: "Remove Admin Rights" })).toBeTruthy();
    expect(marketingCard.getByRole("button", { name: "Remove Olivia Owner" })).toBeTruthy();
    expect(marketingCard.getByRole("button", { name: "Remove Mia Member" })).toBeTruthy();
    expect(marketingCard.getByRole("button", { name: "Add a New Member" })).toBeTruthy();
  });

  it("does not toggle the card on a summary link", async () => {
    confirm.mockReturnValue(false);
    const { memberReads } = await renderProjects();

    fireEvent.click(summary("Marketing").getByRole("link", { name: "Remove" }));
    expect(card("Marketing").open).toBe(false);
    fireEvent.click(summary("Marketing").getByRole("link", { name: "Rename" }));

    expect(screen.getByRole("textbox", { name: "Project name" })).toBeTruthy();
    expect(memberReads).toEqual([]);
  });

  it("shows a plain member the rows without controls", async () => {
    await renderProjects();

    const engineeringCard = await open("Engineering");

    expect(engineeringCard.queryByText("Make Admin")).toBeNull();
    expect(engineeringCard.queryByText("Remove Admin Rights")).toBeNull();
    expect(engineeringCard.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(engineeringCard.queryByRole("button", { name: "Add a New Member" })).toBeNull();
    const rows = card("Engineering").querySelectorAll(".v2-class---account-page__project-user");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.classList.contains("v2-class---account-page__project-user--not-admin")).toBe(true);
    }
  });

  it("creates a project and reads the list again", async () => {
    const { writes, projectReads } = await renderProjects();

    fireEvent.click(screen.getByRole("button", { name: "Create a Project" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    expect(input.getAttribute("placeholder")).toBe("Enter a project name...");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Create a Project" })).toBeNull();
    fireEvent.change(input, { target: { value: "New team" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull());
    expect(writes.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "POST", path: "/api/v1/projects", body: { name: "New team" } },
    ]);
    expect(projectReads).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Create a Project" })).toBeTruthy();
  });

  it("keeps the create editor open with the server's refusal of the name", async () => {
    await renderProjects(undefined, () => problemAnswer(422, "validation-failed"));

    fireEvent.click(screen.getByRole("button", { name: "Create a Project" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Enter a project name.");
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeTruthy();
  });

  it("closes the create editor on Cancel without a request", async () => {
    const { writes } = await renderProjects();

    fireEvent.click(screen.getByRole("button", { name: "Create a Project" }));
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create a Project" })).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("renames a project with a merge patch", async () => {
    const { writes } = await renderProjects();

    fireEvent.click(summary("Marketing").getByRole("link", { name: "Rename" }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" });
    expect(input.value).toBe("Marketing");
    fireEvent.change(input, { target: { value: "Marketing 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull());
    expect(
      writes.map(({ method, path, contentType, body }) => ({ method, path, contentType, body })),
    ).toEqual([
      {
        method: "PATCH",
        path: `/api/v1/projects/${marketing.id}`,
        contentType: "application/merge-patch+json",
        body: { name: "Marketing 2" },
      },
    ]);
  });

  it("asks before deleting a project and sends nothing when declined", async () => {
    confirm.mockReturnValue(false);
    const { writes } = await renderProjects();

    fireEvent.click(summary("Marketing").getByRole("link", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(DELETE_PROJECT_CONFIRMATION);
    expect(writes).toEqual([]);
  });

  it("deletes a project once confirmed and shows a refusal in the card", async () => {
    const { writes } = await renderProjects(undefined, () => problemAnswer(403, "forbidden"));

    fireEvent.click(summary("Marketing").getByRole("link", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(DELETE_PROJECT_CONFIRMATION);
    const alert = await within(card("Marketing")).findByRole("alert");
    expect(alert.textContent).toBe("Only project admins can do this.");
    expect(card("Marketing").open).toBe(true);
    expect(writes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "DELETE", path: `/api/v1/projects/${marketing.id}` },
    ]);
  });

  describe("adding a member", () => {
    async function add(answer: (write: RecordedWrite) => WriteAnswer = success) {
      const rendered = await renderProjects(undefined, answer);
      const marketingCard = await open("Marketing");
      fireEvent.click(marketingCard.getByRole("button", { name: "Add a New Member" }));
      const input = marketingCard.getByRole("textbox", { name: "New member's email" });
      expect(input.getAttribute("placeholder")).toBe("Enter the new member's email...");
      fireEvent.change(input, { target: { value: "nobody@example.test" } });
      fireEvent.click(marketingCard.getByRole("button", { name: "Add" }));
      return { ...rendered, marketingCard };
    }

    it("sends the email as a user, then closes the form and reads the members again", async () => {
      const { writes, memberReads, marketingCard } = await add();

      await waitFor(() =>
        expect(marketingCard.queryByRole("textbox", { name: "New member's email" })).toBeNull(),
      );
      expect(writes.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        {
          method: "POST",
          path: `/api/v1/projects/${marketing.id}/members`,
          body: { email: "nobody@example.test", role: "user" },
        },
      ]);
      await waitFor(() => expect(memberReads).toHaveLength(2));
      expect(marketingCard.getByRole("button", { name: "Add a New Member" })).toBeTruthy();
    });

    it("explains an address that is not registered and keeps the form", async () => {
      const { marketingCard } = await add(() => problemAnswer(404, "user-not-found"));

      expect((await marketingCard.findByRole("alert")).textContent).toBe(
        "nobody@example.test is not a registered surveyjs.io user. Ask them to sign up first.",
      );
      expect(
        marketingCard.getByRole<HTMLInputElement>("textbox", { name: "New member's email" }).value,
      ).toBe("nobody@example.test");
    });

    it("explains an address that is already a member", async () => {
      const { marketingCard } = await add(() => problemAnswer(409, "already-member"));

      expect((await marketingCard.findByRole("alert")).textContent).toBe(
        "nobody@example.test is already a member of this project.",
      );
    });
  });

  it("makes a member an admin", async () => {
    const { writes } = await renderProjects();
    await open("Marketing");

    fireEvent.click(within(memberRow("Mia Member")).getByRole("link", { name: "Make Admin" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      writes.map(({ method, path, contentType, body }) => ({ method, path, contentType, body })),
    ).toEqual([
      {
        method: "PATCH",
        path: `/api/v1/projects/${marketing.id}/members/${otherMember.userId}`,
        contentType: "application/merge-patch+json",
        body: { role: "admin" },
      },
    ]);
  });

  it("shows the last-admin refusal when the only admin gives up the rights", async () => {
    const { writes } = await renderProjects(undefined, () => problemAnswer(409, "last-admin"));
    const marketingCard = await open("Marketing");

    fireEvent.click(
      within(memberRow("Olivia Owner")).getByRole("link", { name: "Remove Admin Rights" }),
    );

    expect((await marketingCard.findByRole("alert")).textContent).toBe(
      "A project must keep at least one admin. Make another member an admin first.",
    );
    expect(writes.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: "PATCH",
        path: `/api/v1/projects/${marketing.id}/members/${currentUser.id}`,
        body: { role: "user" },
      },
    ]);
  });

  it("asks before removing another member, then removes them", async () => {
    const { writes } = await renderProjects();
    const marketingCard = await open("Marketing");

    fireEvent.click(marketingCard.getByRole("button", { name: "Remove Mia Member" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(removeMemberConfirmation("Mia Member"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "DELETE", path: `/api/v1/projects/${marketing.id}/members/${otherMember.userId}` },
    ]);
  });

  it("removes the member with Enter on the focused x", async () => {
    const { writes } = await renderProjects();
    const marketingCard = await open("Marketing");

    const remove = marketingCard.getByRole("button", { name: "Remove Mia Member" });
    expect(remove.tabIndex).toBe(0);
    fireEvent.keyDown(remove, { key: "Enter" });

    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("treats the x on the admin's own row as leaving, and reads the list again", async () => {
    const { writes, projectReads } = await renderProjects();
    const marketingCard = await open("Marketing");

    fireEvent.click(marketingCard.getByRole("button", { name: "Remove Olivia Owner" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(LEAVE_PROJECT_CONFIRMATION);
    await waitFor(() => expect(projectReads).toHaveLength(2));
    expect(writes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "DELETE", path: `/api/v1/projects/${marketing.id}/members/${currentUser.id}` },
    ]);
  });

  it("lets a plain member leave a project", async () => {
    const { writes, projectReads } = await renderProjects();

    fireEvent.click(summary("Engineering").getByRole("link", { name: "Leave Project" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(LEAVE_PROJECT_CONFIRMATION);
    await waitFor(() => expect(projectReads).toHaveLength(2));
    expect(writes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "DELETE", path: `/api/v1/projects/${engineering.id}/members/${currentUser.id}` },
    ]);
  });

  it("says so when the members cannot be read", async () => {
    await renderProjects();
    server.use(
      mswHttp.get("*/api/v1/projects/:projectId/members", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Internal error", status: 500, code: "internal-error" },
          { status: 500, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );

    fireEvent.click(card("Marketing").querySelector("summary")!);

    expect((await within(card("Marketing")).findByRole("alert")).textContent).toBe(
      "Could not load the members. Please try again.",
    );
  });

  it("shows only the intro and Create a Project without projects", async () => {
    await renderProjects([]);

    expect(
      screen.getByText((_, element) => element?.tagName === "P" && element.textContent === INTRO),
    ).toBeTruthy();
    expect(document.querySelector(".v2-class---account-page__projects")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Create a Project" })).toBeTruthy();
  });
});

describe("navigation to the Projects page", () => {
  it("goes there from the plain shell's header link", async () => {
    server.use(configHandler(), meHandler(), ...surveyListPageHandlers());
    const router = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "My Surveys" });

    const link = screen.getByRole("link", { name: "Projects" });
    expect(link.closest("header")?.querySelector("strong")?.textContent).toBe("My Surveys");
    expect(link.getAttribute("href")).toBe("/projects");
    fireEvent.click(link);

    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(router.state.location.pathname).toBe("/projects");
  });

  it("goes there from Manage Projects at the end of the project selector", async () => {
    server.use(
      configHandler(),
      meHandler(),
      // Before the page's own handlers: the first match answers.
      projectsHandler({ "": { items: [marketing], nextCursor: null } }),
      ...surveyListPageHandlers(),
    );
    const router = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "My Surveys" });

    fireEvent.click(screen.getByRole("button", { name: "Personal Surveys" }));
    const items = document.querySelectorAll(
      ".v2-class---drop-down-button .v2-class---drop-down-menu-item",
    );
    expect(Array.from(items, (item) => item.textContent)).toEqual([
      "Personal Surveys",
      "Marketing",
      "Manage Projects",
    ]);
    fireEvent.click(screen.getByRole("link", { name: "Manage Projects" }));

    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(router.state.location.pathname).toBe("/projects");
  });
});
