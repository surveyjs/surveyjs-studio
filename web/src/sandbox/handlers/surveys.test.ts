import { describe, expect, it } from "vitest";
import { PROJECTS, setupSandbox, SURVEYS, USERS } from "./testing";

const patch = (json: unknown) => ({
  method: "PATCH",
  json,
  headers: { "Content-Type": "application/merge-patch+json" },
});

const ids = (page: { items: { id: string }[] }) => page.items.map((s) => s.id);

describe("GET /surveys", () => {
  it("lists the personal active surveys, newest update first", async () => {
    const { call } = setupSandbox();
    const response = await call("/surveys", { user: USERS.owner });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(ids(page)).toEqual([SURVEYS.feedback, SURVEYS.draft]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      name: "Customer feedback",
      projectId: null,
      published: true,
      archived: false,
      permissions: { canModify: true },
      settings: { publicResults: true, storeRespondentIp: true },
    });
    // The list leaves the private-question list out, as the server's survey JSON without it.
    expect(page.items[0].settings).not.toHaveProperty("privateResultQuestions");
    expect(page.items[0]).not.toHaveProperty("useCookies");
  });

  it("lists archived surveys with archived=true", async () => {
    const { call } = setupSandbox();
    const page = await (await call("/surveys?archived=true", { user: USERS.owner })).json();
    expect(ids(page)).toEqual([SURVEYS.oldPoll]);
  });

  it("pages with cursors: two pages, then a cursor of another list or a bad one is 400", async () => {
    const { call } = setupSandbox();
    const first = await (await call("/surveys?limit=1", { user: USERS.owner })).json();
    expect(ids(first)).toEqual([SURVEYS.feedback]);
    expect(typeof first.nextCursor).toBe("string");
    const second = await (
      await call(`/surveys?limit=1&cursor=${first.nextCursor}`, { user: USERS.owner })
    ).json();
    expect(ids(second)).toEqual([SURVEYS.draft]);
    expect(second.nextCursor).toBeNull();

    // The cursor belongs to the personal active list.
    const other = await call(`/surveys?archived=true&cursor=${first.nextCursor}`, {
      user: USERS.owner,
    });
    expect(other.status).toBe(400);
    const bad = await call("/surveys?cursor=not-a-cursor", { user: USERS.owner });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "bad-request", detail: "Invalid cursor." });
  });

  it("lists a project's surveys for a member, with permissions per survey", async () => {
    const { call } = setupSandbox();
    const page = await (
      await call(`/surveys?project=${PROJECTS.marketing}`, { user: USERS.member })
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: SURVEYS.campaign,
      projectId: PROJECTS.marketing,
      permissions: { canModify: true },
    });
    const archived = await (
      await call(`/surveys?project=${PROJECTS.marketing}&archived=true`, { user: USERS.member })
    ).json();
    // A plain member cannot modify what a project admin created.
    expect(archived.items[0]).toMatchObject({
      id: SURVEYS.archivedCampaign,
      permissions: { canModify: false },
    });
  });

  it("answers 404 for a project the user is not in or that does not exist", async () => {
    const { call } = setupSandbox();
    expect(
      (await call(`/surveys?project=${PROJECTS.marketing}`, { user: USERS.outsider })).status,
    ).toBe(404);
    expect((await call("/surveys?project=nope", { user: USERS.owner })).status).toBe(404);
  });

  it("answers 400 for a bad limit and 401 without a session", async () => {
    const { call } = setupSandbox();
    expect((await call("/surveys?limit=0", { user: USERS.owner })).status).toBe(400);
    expect((await call("/surveys?limit=201", { user: USERS.owner })).status).toBe(400);
    expect((await call("/surveys?archived=maybe", { user: USERS.owner })).status).toBe(400);
    expect((await call("/surveys")).status).toBe(401);
  });
});

describe("POST /surveys", () => {
  it("creates a published personal survey named New Survey N", async () => {
    const { call } = setupSandbox();
    const response = await call("/surveys", { method: "POST", user: USERS.owner });
    expect(response.status).toBe(201);
    const survey = await response.json();
    expect(response.headers.get("location")).toBe(`/api/v1/surveys/${survey.id}`);
    expect(survey).toMatchObject({
      name: "New Survey 1",
      projectId: null,
      published: true,
      archived: false,
      permissions: { canModify: true },
      settings: { publicResults: false, storeRespondentIp: false, privateResultQuestions: [] },
    });
    expect(survey.postId).not.toBe(survey.resultId);
    const second = await (await call("/surveys", { method: "POST", user: USERS.owner })).json();
    expect(second.name).toBe("New Survey 2");
    // Created last, so listed first.
    const page = await (await call("/surveys", { user: USERS.owner })).json();
    expect(page.items[0].id).toBe(second.id);
  });

  it("creates in a project with a given name and definition (one history entry)", async () => {
    const { call } = setupSandbox();
    const response = await call("/surveys", {
      method: "POST",
      user: USERS.member,
      json: { name: "Poll", projectId: PROJECTS.marketing, definition: { title: "Poll" } },
    });
    expect(response.status).toBe(201);
    const survey = await response.json();
    expect(survey).toMatchObject({ name: "Poll", projectId: PROJECTS.marketing });
    const definition = await call(`/surveys/${survey.id}/definition`, { user: USERS.member });
    expect(await definition.json()).toEqual({ title: "Poll" });
    const history = await (
      await call(`/surveys/${survey.id}/history`, { user: USERS.member })
    ).json();
    expect(history.items).toHaveLength(1);
    expect(history.items[0].user).toEqual({ id: USERS.member, displayName: "Mia Member" });
  });

  it("refuses a project the user is not in (403), a blank name (422) and no session (401)", async () => {
    const { call } = setupSandbox();
    const notMember = await call("/surveys", {
      method: "POST",
      user: USERS.outsider,
      json: { projectId: PROJECTS.marketing },
    });
    expect(notMember.status).toBe(403);
    expect(await notMember.json()).toMatchObject({
      code: "forbidden",
      detail: "You are not a member of this project.",
    });
    const blank = await call("/surveys", {
      method: "POST",
      user: USERS.owner,
      json: { name: "  " },
    });
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
    expect((await call("/surveys", { method: "POST", json: {} })).status).toBe(401);
  });
});

describe("GET /surveys/{id}", () => {
  it("answers the record with the private-question list", async () => {
    const { call } = setupSandbox();
    const survey = await (await call(`/surveys/${SURVEYS.feedback}`, { user: USERS.owner })).json();
    expect(survey.settings.privateResultQuestions).toEqual(["receipt"]);
    expect(survey.permissions.canModify).toBe(true);
  });

  it("answers 404 for an unknown survey and for one the user cannot see", async () => {
    const { call } = setupSandbox();
    expect((await call("/surveys/nope", { user: USERS.owner })).status).toBe(404);
    expect((await call(`/surveys/${SURVEYS.feedback}`, { user: USERS.member })).status).toBe(404);
    expect((await call(`/surveys/${SURVEYS.campaign}`, { user: USERS.outsider })).status).toBe(404);
    expect((await call(`/surveys/${SURVEYS.feedback}`)).status).toBe(401);
  });

  it("answers 400 bad-request for an id longer than 64 characters, after the session check", async () => {
    const { call } = setupSandbox();
    const long = await call(`/surveys/${"x".repeat(65)}`, { user: USERS.owner });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({
      code: "bad-request",
      errors: [{ pointer: "/surveyId", detail: "must NOT have more than 64 characters" }],
    });
    expect((await call(`/surveys/${"x".repeat(64)}`, { user: USERS.owner })).status).toBe(404);
    expect((await call(`/surveys/${"x".repeat(65)}`)).status).toBe(401);
  });
});

describe("PATCH /surveys/{id}", () => {
  it("renames, moves updatedAt and answers the survey", async () => {
    const { call } = setupSandbox();
    const response = await call(`/surveys/${SURVEYS.feedback}`, {
      ...patch({ name: "Renamed" }),
      user: USERS.owner,
    });
    expect(response.status).toBe(200);
    const survey = await response.json();
    expect(survey.name).toBe("Renamed");
    expect(survey.updatedAt > "2026-04-14T15:30:00.000Z").toBe(true);
    const page = await (await call("/surveys", { user: USERS.owner })).json();
    expect(page.items[0].name).toBe("Renamed");
  });

  it("archives, unpublishes and changes settings (merged), and saves the private-question list", async () => {
    const { call } = setupSandbox();
    const survey = await (
      await call(`/surveys/${SURVEYS.feedback}`, {
        ...patch({
          archived: true,
          published: false,
          settings: { publicResults: true, privateResultQuestions: ["a", "b"] },
        }),
        user: USERS.owner,
      })
    ).json();
    expect(survey).toMatchObject({
      archived: true,
      published: false,
      settings: {
        publicResults: true,
        storeRespondentIp: true,
        privateResultQuestions: ["a", "b"],
      },
    });
    const active = await (await call("/surveys", { user: USERS.owner })).json();
    expect(ids(active)).toEqual([SURVEYS.draft]);
  });

  it("moves a survey to a project (the caller becomes its creator) and back to Personal", async () => {
    const { call } = setupSandbox();
    const moved = await (
      await call(`/surveys/${SURVEYS.draft}`, {
        ...patch({ projectId: PROJECTS.engineering }),
        user: USERS.owner,
      })
    ).json();
    expect(moved).toMatchObject({ projectId: PROJECTS.engineering });
    // Olivia is a plain member of Engineering but the creator now: she may modify it.
    expect(moved.permissions.canModify).toBe(true);
    const back = await (
      await call(`/surveys/${SURVEYS.draft}`, { ...patch({ projectId: null }), user: USERS.owner })
    ).json();
    expect(back).toMatchObject({ projectId: null });
  });

  it("refuses a move to a project the caller is not in (403)", async () => {
    const { call } = setupSandbox();
    const refused = await call(`/surveys/${SURVEYS.quiz}`, {
      ...patch({ projectId: PROJECTS.marketing }),
      user: USERS.outsider,
    });
    expect(refused.status).toBe(403);
  });

  it("answers 403 without modify rights and 404 for a survey the user cannot see", async () => {
    const { call } = setupSandbox();
    const noRights = await call(`/surveys/${SURVEYS.archivedCampaign}`, {
      ...patch({ name: "x" }),
      user: USERS.member,
    });
    expect(noRights.status).toBe(403);
    expect(await noRights.json()).toMatchObject({
      code: "forbidden",
      detail: "You cannot modify this survey.",
    });
    // A member cannot modify (or see) the owner's personal survey.
    const hidden = await call(`/surveys/${SURVEYS.feedback}`, {
      ...patch({ name: "x" }),
      user: USERS.member,
    });
    expect(hidden.status).toBe(404);
    // A project admin may modify any project survey.
    const admin = await call(`/surveys/${SURVEYS.archivedCampaign}`, {
      ...patch({ name: "x" }),
      user: USERS.admin,
    });
    expect(admin.status).toBe(200);
  });

  it("answers 422 for an empty patch, a blank name and a wrong type; 415 for another media type", async () => {
    const { call } = setupSandbox();
    const send = (json: unknown) =>
      call(`/surveys/${SURVEYS.feedback}`, { ...patch(json), user: USERS.owner });
    expect((await send({})).status).toBe(422);
    expect((await send({ name: "" })).status).toBe(422);
    expect((await send({ archived: "yes" })).status).toBe(422);
    const wrongType = await call(`/surveys/${SURVEYS.feedback}`, {
      method: "PATCH",
      user: USERS.owner,
      body: "name=x",
      headers: { "Content-Type": "text/plain" },
    });
    expect(wrongType.status).toBe(415);
    const missing = await call(`/surveys/${SURVEYS.feedback}`, {
      method: "PATCH",
      user: USERS.owner,
    });
    expect(missing.status).toBe(422);
  });
});

describe("DELETE /surveys/{id}", () => {
  it("deletes only an archived survey, with everything that belongs to it", async () => {
    const { call, ctx } = setupSandbox();
    const active = await call(`/surveys/${SURVEYS.campaign}`, {
      method: "DELETE",
      user: USERS.admin,
    });
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({
      code: "survey-not-archived",
      title: "Archive the survey before deleting it",
    });
    await call(`/surveys/${SURVEYS.campaign}`, { ...patch({ archived: true }), user: USERS.admin });
    const deleted = await call(`/surveys/${SURVEYS.campaign}`, {
      method: "DELETE",
      user: USERS.admin,
    });
    expect(deleted.status).toBe(204);
    expect((await call(`/surveys/${SURVEYS.campaign}`, { user: USERS.admin })).status).toBe(404);
    const data = ctx.store.read();
    expect(data.surveys.some((s) => s.id === SURVEYS.campaign)).toBe(false);
    expect(data.definitions[SURVEYS.campaign]).toBeUndefined();
    expect(data.responses[SURVEYS.campaign]).toBeUndefined();
  });

  it("answers 403 without modify rights and 404 for an unknown survey", async () => {
    const { call } = setupSandbox();
    expect(
      (await call(`/surveys/${SURVEYS.archivedCampaign}`, { method: "DELETE", user: USERS.member }))
        .status,
    ).toBe(403);
    expect((await call("/surveys/nope", { method: "DELETE", user: USERS.owner })).status).toBe(404);
  });
});

describe("POST /surveys/{id}/clones", () => {
  it("copies the definition and theme into a new published survey called Copy of ...", async () => {
    const { call } = setupSandbox();
    const response = await call(`/surveys/${SURVEYS.feedback}/clones`, {
      method: "POST",
      user: USERS.owner,
    });
    expect(response.status).toBe(201);
    const copy = await response.json();
    expect(response.headers.get("location")).toBe(`/api/v1/surveys/${copy.id}`);
    expect(copy).toMatchObject({
      name: "Copy of Customer feedback",
      projectId: null,
      published: true,
      archived: false,
      settings: { publicResults: false, storeRespondentIp: false, privateResultQuestions: [] },
    });
    expect(copy.id).not.toBe(SURVEYS.feedback);
    const source = await (
      await call(`/surveys/${SURVEYS.feedback}/definition`, { user: USERS.owner })
    ).json();
    const copied = await (
      await call(`/surveys/${copy.id}/definition`, { user: USERS.owner })
    ).json();
    expect(copied).toEqual(source);
    const theme = await (await call(`/surveys/${copy.id}/theme`, { user: USERS.owner })).json();
    expect(theme).toEqual(
      await (await call(`/surveys/${SURVEYS.feedback}/theme`, { user: USERS.owner })).json(),
    );
  });

  it("clones into another scope with a given name; a user who cannot see the source gets 404", async () => {
    const { call } = setupSandbox();
    const copy = await (
      await call(`/surveys/${SURVEYS.campaign}/clones`, {
        method: "POST",
        user: USERS.member,
        json: { name: "Mine", projectId: null },
      })
    ).json();
    expect(copy).toMatchObject({ name: "Mine", projectId: null });
    const outsider = await call(`/surveys/${SURVEYS.campaign}/clones`, {
      method: "POST",
      user: USERS.outsider,
    });
    expect(outsider.status).toBe(404);
    const refused = await call(`/surveys/${SURVEYS.quiz}/clones`, {
      method: "POST",
      user: USERS.outsider,
      json: { projectId: PROJECTS.marketing },
    });
    expect(refused.status).toBe(403);
  });

  it("cuts a long default name to 200 characters and copies the editor's files with new ids", async () => {
    const { call, ctx } = setupSandbox();
    const long = "x".repeat(200);
    const renamed = await call(`/surveys/${SURVEYS.draft}`, {
      ...patch({ name: long }),
      user: USERS.owner,
    });
    expect(renamed.status).toBe(200);
    const hex = SURVEYS.draft.replaceAll("-", "");
    const fileId = hex + "ab".repeat(16);
    const file = {
      surveyId: SURVEYS.draft,
      name: "a.png",
      contentType: "image/png",
      size: 3,
      base64: "AAEC",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await ctx.store.write((data) => {
      data.files.push({ ...file, id: fileId });
      data.files.push({ ...file, id: hex + "cd".repeat(16), kind: "respondent" });
      data.definitions[SURVEYS.draft] = { logo: `http://localhost/api/v1/public/files/${fileId}` };
    });
    const copy = await (
      await call(`/surveys/${SURVEYS.draft}/clones`, { method: "POST", user: USERS.owner })
    ).json();
    expect(copy.name).toBe(`Copy of ${long}`.slice(0, 200));
    const data = ctx.store.read();
    const copied = data.files.filter((f) => f.surveyId === copy.id);
    expect(copied).toHaveLength(1);
    expect(copied[0]!.id.startsWith(copy.id.replaceAll("-", ""))).toBe(true);
    expect(copied[0]!.id).not.toBe(fileId);
    expect(copied[0]).toMatchObject({ name: "a.png", base64: "AAEC", size: 3 });
    expect(JSON.stringify(data.definitions[copy.id])).toContain(copied[0]!.id);
    expect(JSON.stringify(data.definitions[copy.id])).not.toContain(fileId);
    // The source keeps its files and definition.
    expect(data.files.filter((f) => f.surveyId === SURVEYS.draft)).toHaveLength(2);
  });
});
