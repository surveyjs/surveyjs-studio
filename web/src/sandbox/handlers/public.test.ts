import { describe, expect, it } from "vitest";
import { seed, setupSandbox, SURVEYS, USERS } from "./testing";

const submit = (surveyId: string, body: unknown, headers: Record<string, string> = {}) => ({
  path: `/public/surveys/${surveyId}/responses`,
  init: { method: "POST", json: body, headers },
});

describe("getPublishedSurvey", () => {
  it("answers the published survey, archived or not, without signing in", async () => {
    const { call } = setupSandbox();
    const response = await call(`/public/surveys/${SURVEYS.draft}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      id: SURVEYS.draft,
      name: "Draft idea",
      definition: seed.definitions[SURVEYS.draft] ?? {},
      theme: seed.themes[SURVEYS.draft] ?? {},
    });
    // Archived and published: runs.
    expect((await call(`/public/surveys/${SURVEYS.archivedCampaign}`)).status).toBe(200);
  });

  it("answers 404 survey-not-available for an unpublished or unknown survey", async () => {
    const { call } = setupSandbox();
    for (const id of [SURVEYS.oldPoll, SURVEYS.retro, "nope"]) {
      const response = await call(`/public/surveys/${id}`);
      expect(response.status, id).toBe(404);
      expect(await response.json()).toMatchObject({ code: "survey-not-available" });
    }
  });

  it("sets cookieName to the survey id for the legacy one-response setting, unless the definition names one", async () => {
    const { call } = setupSandbox();
    const limited = await (await call(`/public/surveys/${SURVEYS.feedback}`)).json();
    expect(limited.definition.cookieName).toBe(SURVEYS.feedback);
    expect(limited.definition.title).toBe("Customer feedback");
  });

  it("tells whether a client has completed it, only when clientId is given", async () => {
    const { call } = setupSandbox();
    const path = `/public/surveys/${SURVEYS.feedback}`;
    expect(await (await call(`${path}?clientId=someone`)).json()).toMatchObject({
      completed: false,
    });
    // The seed's marker of client-0001 is partial: not completed.
    expect(await (await call(`${path}?clientId=client-0001`)).json()).toMatchObject({
      completed: false,
    });
    expect(await (await call(path)).json()).not.toHaveProperty("completed");
    const bad = await call(`${path}?clientId=a%2Fb`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: "bad-request",
      errors: [{ pointer: "/clientId" }],
    });
  });
});

describe("publishing", () => {
  it("lets updateSurvey unpublish and publish a survey, and getPublishedSurvey follows", async () => {
    const { call } = setupSandbox();
    const patch = (published: boolean) =>
      call(`/surveys/${SURVEYS.draft}`, {
        method: "PATCH",
        user: USERS.owner,
        json: { published },
        headers: { "Content-Type": "application/merge-patch+json" },
      });
    expect((await patch(false)).status).toBe(200);
    expect((await call(`/public/surveys/${SURVEYS.draft}`)).status).toBe(404);
    const submitted = submit(SURVEYS.draft, { data: {} });
    expect((await call(submitted.path, submitted.init)).status).toBe(404);
    expect((await patch(true)).status).toBe(200);
    expect((await call(`/public/surveys/${SURVEYS.draft}`)).status).toBe(200);
    expect((await call(submitted.path, submitted.init)).status).toBe(201);
  });
});

describe("submitResponse", () => {
  it("stores a response, which listResults and getResultStats then show", async () => {
    const { call } = setupSandbox();
    const { path, init } = submit(SURVEYS.draft, { data: { q1: "yes" }, clientId: "c-1" });
    const response = await call(path, init);
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await (
      await call(`/surveys/${SURVEYS.draft}/results`, { user: USERS.owner })
    ).json();
    expect(list.items).toStrictEqual([
      { id, submittedAt: expect.any(String), data: { q1: "yes" }, clientId: "c-1" },
    ]);
    const stats = await (
      await call(`/surveys/${SURVEYS.draft}/results/stats`, { user: USERS.owner })
    ).json();
    expect(stats).toStrictEqual({
      count: 1,
      firstSubmittedAt: list.items[0].submittedAt,
      lastSubmittedAt: list.items[0].submittedAt,
    });
  });

  it("stores no IP address even when the survey asks for it", async () => {
    const { call } = setupSandbox();
    const { path, init } = submit(SURVEYS.campaign, { data: { satisfaction: 5 } });
    expect((await call(path, init)).status).toBe(201);
    const list = await (
      await call(`/surveys/${SURVEYS.campaign}/results`, { user: USERS.owner })
    ).json();
    expect(list.items.at(-1)).not.toHaveProperty("respondentIp");
  });

  it("answers a replay of the same Idempotency-Key with the same id and stores nothing more", async () => {
    const { call } = setupSandbox();
    const { path, init } = submit(
      SURVEYS.draft,
      { data: { a: 1 } },
      { "Idempotency-Key": "key-1" },
    );
    const first = await (await call(path, init)).json();
    const replay = await (await call(path, { ...init, json: { data: { a: 2 } } })).json();
    expect(replay).toStrictEqual(first);
    const other = await (
      await call(path, { ...init, headers: { "Idempotency-Key": "key-2" } })
    ).json();
    expect(other.id).not.toBe(first.id);
    // The key is per survey.
    const elsewhere = submit(SURVEYS.campaign, { data: { a: 1 } }, { "Idempotency-Key": "key-1" });
    expect((await (await call(elsewhere.path, elsewhere.init)).json()).id).not.toBe(first.id);
    const stats = await (
      await call(`/surveys/${SURVEYS.draft}/results/stats`, { user: USERS.owner })
    ).json();
    expect(stats.count).toBe(2);
  });

  it("answers already-completed for the same clientId of a limited survey, but a replay still answers 201", async () => {
    const { call } = setupSandbox();
    const body = { data: { satisfaction: 3 }, clientId: "client-x" };
    const { path, init } = submit(SURVEYS.feedback, body, { "Idempotency-Key": "k" });
    expect((await call(path, init)).status).toBe(201);
    expect(
      await (await call(`/public/surveys/${SURVEYS.feedback}?clientId=client-x`)).json(),
    ).toMatchObject({
      completed: true,
    });
    const again = await call(path, { ...init, headers: { "Idempotency-Key": "k2" } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already-completed", status: 409 });
    // The original key answers as the original did.
    expect((await call(path, init)).status).toBe(201);
    // Another client may still answer.
    const other = submit(SURVEYS.feedback, { data: {}, clientId: "client-y" });
    expect((await call(other.path, other.init)).status).toBe(201);
  });

  it("does not limit a survey without the one-response setting", async () => {
    const { call } = setupSandbox();
    const body = { data: { a: 1 }, clientId: "same" };
    const { path, init } = submit(SURVEYS.draft, body);
    expect((await call(path, init)).status).toBe(201);
    expect((await call(path, init)).status).toBe(201);
  });

  it("is 404 for an unpublished survey and 422 or 415 for a bad body", async () => {
    const { call } = setupSandbox();
    const unpublished = submit(SURVEYS.retro, { data: {} });
    expect((await call(unpublished.path, unpublished.init)).status).toBe(404);
    const noData = submit(SURVEYS.draft, {});
    const invalid = await call(noData.path, noData.init);
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/data" }],
    });
    const empty = await call(noData.path, { method: "POST" });
    expect(empty.status).toBe(422);
    const wrongType = await call(noData.path, {
      method: "POST",
      body: "data=1",
      headers: { "Content-Type": "text/plain" },
    });
    expect(wrongType.status).toBe(415);
  });
});

describe("getPublicResults", () => {
  const path = (id: string) => `/public/surveys/${id}/results`;

  it("answers 404 survey-not-available unless Grant Access is on", async () => {
    const { call } = setupSandbox();
    for (const id of [SURVEYS.draft, SURVEYS.campaign, "nope"]) {
      const response = await call(path(id));
      expect(response.status, id).toBe(404);
      expect(await response.json()).toMatchObject({ code: "survey-not-available" });
    }
  });

  it("answers the pages without ids, client ids and the private questions' answers", async () => {
    const { call } = setupSandbox();
    const response = await call(`${path(SURVEYS.feedback)}?limit=2`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const page = await response.json();
    expect(page.survey).toStrictEqual({
      id: SURVEYS.feedback,
      name: "Customer feedback",
      definition: seed.definitions[SURVEYS.feedback],
      privateQuestions: ["receipt"],
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toStrictEqual({
      submittedAt: "2026-04-01T08:00:00.500Z",
      data: seed.responses[SURVEYS.feedback]![0]!.data,
    });
    const next = await (
      await call(`${path(SURVEYS.feedback)}?limit=3&cursor=${page.nextCursor}`)
    ).json();
    expect(next.items).toHaveLength(3);
    expect(next.nextCursor).toBeNull();
    for (const item of next.items) expect(item.data).not.toHaveProperty("receipt");
    expect(next.items[2].data).toHaveProperty("satisfaction");
    expect((await call(`${path(SURVEYS.feedback)}?limit=1001`)).status).toBe(400);
    expect((await call(`${path(SURVEYS.feedback)}?cursor=bad`)).status).toBe(400);
  });
});
