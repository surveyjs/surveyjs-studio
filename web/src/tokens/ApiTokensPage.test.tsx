import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiToken, ApiTokenList } from "../api/tokens";
import { renderApp } from "../test/renderApp";
import { appConfig, configHandler, meHandler, sampleProject, server } from "../test/server";

const VALUE = `sjs_${"A".repeat(43)}`;
const REVOKE_KEY_QUESTION = "Revoke this key? Integrations that use it stop working.";

const marketing = sampleProject;
const engineering = {
  ...sampleProject,
  id: "55555555-0000-4000-8000-a00000000002",
  name: "Engineering",
  role: "user" as const,
};

const personalToken: ApiToken = {
  id: "77777777-0000-4000-8000-000000000001",
  name: "Nightly export",
  projectId: null,
  lastFour: "wxyz",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: null,
  createdBy: { id: "00000000-0000-4000-8000-000000000001", displayName: "Olivia Owner" },
};
const projectToken: ApiToken = {
  ...personalToken,
  id: "77777777-0000-4000-8000-000000000002",
  name: "Marketing CI",
  projectId: marketing.id,
  lastFour: "abcd",
};

const withTokens = {
  ...appConfig,
  features: { ...appConfig.features, apiTokens: true, legacyKeyRevoke: true },
};

interface Setup {
  config?: typeof appConfig;
  personal?: ApiTokenList;
}

/** Renders `/api-tokens`; writes and project reads are recorded. */
function renderTokens({ config = withTokens, personal }: Setup = {}) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  const projectReads: string[] = [];
  let personalList: ApiTokenList = personal ?? {
    legacyKey: { lastFour: "9f3c", revocable: true },
    tokens: [personalToken],
  };
  server.use(
    configHandler(config),
    meHandler(),
    mswHttp.get("*/api/v1/projects", () =>
      HttpResponse.json({ items: [marketing, engineering], nextCursor: null }),
    ),
    mswHttp.get("*/api/v1/api-tokens", ({ request }) => {
      const project = new URL(request.url).searchParams.get("project");
      if (project === null) return HttpResponse.json(personalList);
      projectReads.push(project);
      return HttpResponse.json({
        legacyKey: null,
        tokens: project === marketing.id ? [projectToken] : [],
      });
    }),
    mswHttp.post("*/api/v1/api-tokens", async ({ request }) => {
      const body = (await request.json()) as { name: string; projectId: string | null };
      writes.push({ method: "POST", path: "/api-tokens", body });
      const token = { ...personalToken, id: "77777777-0000-4000-8000-0000000000ff", ...body };
      return HttpResponse.json({ token, value: VALUE }, { status: 201 });
    }),
    mswHttp.delete("*/api/v1/api-tokens/legacy-key", () => {
      writes.push({ method: "DELETE", path: "/api-tokens/legacy-key", body: null });
      personalList = { ...personalList, legacyKey: null };
      return new HttpResponse(null, { status: 204 });
    }),
    mswHttp.delete("*/api/v1/api-tokens/:tokenId", ({ params }) => {
      writes.push({ method: "DELETE", path: `/api-tokens/${String(params.tokenId)}`, body: null });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const router = renderApp("/api-tokens");
  return { router, writes, projectReads };
}

let confirm: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the API tokens page", () => {
  it("is absent without features.apiTokens", async () => {
    renderTokens({ config: appConfig });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "API tokens" })).toBeNull();
  });

  it("lists Personal, and a section only for each project the user administers", async () => {
    const { projectReads } = renderTokens();
    expect(await screen.findByRole("heading", { level: 1, name: "API tokens" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Marketing" })).toBeTruthy();
    expect(await screen.findByText("Marketing CI")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Engineering" })).toBeNull();
    expect(projectReads).toEqual([marketing.id]);
    expect(screen.getByText("Nightly export")).toBeTruthy();
    expect(screen.getByText("…wxyz")).toBeTruthy();
  });

  it("shows the token value once, and not after the dialog is closed", async () => {
    const { writes } = renderTokens();
    await screen.findByRole("heading", { name: "Personal" });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const dialog = await screen.findByRole("dialog", { name: "Create token" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.change(within(dialog).getByLabelText("Scope"), {
      target: { value: marketing.id },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Copy this token now. You won't see it again.")).toBeTruthy();
    expect(writes).toEqual([
      { method: "POST", path: "/api-tokens", body: { name: "CI", projectId: marketing.id } },
    ]);
    expect((screen.getByLabelText("Token") as HTMLInputElement).value).toBe(VALUE);
    expect(screen.getByRole("button", { name: "Copy token" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(VALUE);

    // Opened again: the form is empty, and the value is gone.
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const again = await screen.findByRole("dialog", { name: "Create token" });
    expect(within(again).queryByLabelText("Token")).toBeNull();
    expect((within(again).getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain(VALUE);
  });

  it("offers Personal and the administered projects as scopes", async () => {
    renderTokens();
    await screen.findByRole("heading", { name: "Personal" });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const scope = within(await screen.findByRole("dialog")).getByLabelText("Scope");
    expect(
      within(scope)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Personal", "Marketing"]);
  });

  it("revokes a token after a confirmation", async () => {
    const { writes } = renderTokens();
    const row = (await screen.findByText("Nightly export")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Revoke Nightly export" }));
    await waitFor(() =>
      expect(writes).toEqual([
        { method: "DELETE", path: `/api-tokens/${personalToken.id}`, body: null },
      ]),
    );
    expect(confirm).toHaveBeenCalled();
  });

  it("shows the legacy key with Revoke when it is revocable", async () => {
    const { writes } = renderTokens();
    const row = (await screen.findByText("Legacy access key")).closest("tr")!;
    expect(within(row).getByText("…9f3c")).toBeTruthy();
    expect(within(row).queryByRole("link", { name: "Replace it on surveyjs.io" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    expect(confirm).toHaveBeenCalledWith(REVOKE_KEY_QUESTION);
    await waitFor(() =>
      expect(writes).toEqual([{ method: "DELETE", path: "/api-tokens/legacy-key", body: null }]),
    );
    await waitFor(() => expect(screen.queryByText("Legacy access key")).toBeNull());
  });

  it("links to the site's account page while the legacy key is not revocable", async () => {
    renderTokens({
      config: { ...withTokens, links: { settings: "https://surveyjs.io/account" } },
      personal: { legacyKey: { lastFour: "9f3c", revocable: false }, tokens: [] },
    });
    const row = (await screen.findByText("Legacy access key")).closest("tr")!;
    const link = within(row).getByRole("link", { name: "Replace it on surveyjs.io" });
    expect(link.getAttribute("href")).toBe("https://surveyjs.io/account");
    expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("has no legacy row without a legacy key", async () => {
    renderTokens({ personal: { legacyKey: null, tokens: [] } });
    await screen.findByRole("heading", { name: "Personal" });
    expect(screen.queryByText("Legacy access key")).toBeNull();
  });
});
