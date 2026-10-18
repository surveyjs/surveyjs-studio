import type { Locator, Page } from "@playwright/test";
import { csrfHeaders } from "./survey-list.js";
import { expect, type ExpectedErrorResponse } from "./test.js";

/** A unique project name for one test in one browser. */
export function uniqueProjectName(prefix: string, browserName: string): string {
  return `${prefix} ${browserName} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Adding an unregistered email answers 404 on the members collection, which browsers may log. */
export const MEMBERS_404: ExpectedErrorResponse = {
  path: /^\/api\/v1\/projects\/[0-9a-f-]+\/members$/,
  status: 404,
};

/** The last admin demoting themselves answers 409 on their member resource. */
export const MEMBER_409: ExpectedErrorResponse = {
  path: /^\/api\/v1\/projects\/[0-9a-f-]+\/members\/[0-9a-f-]+$/,
  status: 409,
};

/** Creates a project through the API; the page must be signed in. The caller becomes its admin. */
export async function createProjectViaApi(
  page: Page,
  name: string,
): Promise<{ id: string; name: string }> {
  const response = await page.request.post("/api/v1/projects", {
    headers: await csrfHeaders(page),
    data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/** Adds a member through the API (the signed-in page must be an admin of the project). */
export async function addMemberViaApi(
  page: Page,
  projectId: string,
  email: string,
  role: "user" | "admin" = "user",
): Promise<void> {
  const response = await page.request.post(`/api/v1/projects/${projectId}/members`, {
    headers: await csrfHeaders(page),
    data: { email, role },
  });
  expect(response.status()).toBe(201);
}

/** Deletes a project the test created; a project that is already gone is fine. */
export async function deleteProjectViaApi(page: Page, projectId: string): Promise<void> {
  const response = await page.request.delete(`/api/v1/projects/${projectId}`, {
    headers: await csrfHeaders(page),
  });
  expect([204, 404]).toContain(response.status());
}

/** The id of the signed-in user's project with this name, or undefined. */
export async function findProjectIdViaApi(page: Page, name: string): Promise<string | undefined> {
  let cursor: string | null = null;
  do {
    const next = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await page.request.get(`/api/v1/projects?limit=200${next}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      items: { id: string; name: string }[];
      nextCursor: string | null;
    };
    const found = body.items.find((project) => project.name === name);
    if (found) return found.id;
    cursor = body.nextCursor;
  } while (cursor !== null);
  return undefined;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The card of the project whose title equals `name` exactly. */
export function projectCard(page: Page, name: string): Locator {
  return page.locator("details.v2-class---account-page__project").filter({
    has: page
      .locator(".v2-class---account-page__project-title")
      .filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) }),
  });
}

/** Opens the card (a click on its title) and waits until it is open. */
export async function openProjectCard(page: Page, name: string): Promise<Locator> {
  const card = projectCard(page, name);
  await card.locator(".v2-class---account-page__project-title").click();
  await expect(card).toHaveAttribute("open", "");
  return card;
}

/** The member row whose display name equals `displayName` exactly. */
export function memberRow(card: Locator, displayName: string): Locator {
  return card.locator(".v2-class---account-page__project-user").filter({
    has: card
      .page()
      .locator(".v2-class---account-page__project-user-display-name")
      .filter({ hasText: new RegExp(`^${escapeRegExp(displayName)}$`) }),
  });
}

/** The Admin badge of a member row. */
export function adminBadge(row: Locator): Locator {
  return row.locator(".v2-class---account-page__project-user-admin-label");
}
