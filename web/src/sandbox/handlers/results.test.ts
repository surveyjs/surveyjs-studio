import { describe, expect, it } from "vitest";
import { seed, setupSandbox, SURVEYS, USERS } from "./testing";

const results = (id: string) => `/surveys/${id}/results`;
const seeded = seed.responses[SURVEYS.feedback]!;

describe("listResults", () => {
  it("pages the responses oldest first with cursors", async () => {
    const { call } = setupSandbox();
    const first = await (
      await call(`${results(SURVEYS.feedback)}?limit=2`, { user: USERS.owner })
    ).json();
    expect(first.items.map((r: { id: string }) => r.id)).toEqual(
      seeded.slice(0, 2).map((r) => r.id),
    );
    expect(first.items[1]).toMatchObject({ clientId: "client-0001", data: seeded[1]!.data });
    expect(first.items[0]).not.toHaveProperty("partial");
    const rest = await (
      await call(`${results(SURVEYS.feedback)}?limit=50&cursor=${first.nextCursor}`, {
        user: USERS.owner,
      })
    ).json();
    expect(rest.items.map((r: { id: string }) => r.id)).toEqual(seeded.slice(2).map((r) => r.id));
    expect(rest.nextCursor).toBeNull();
  });

  it("is 400 for a bad limit or a cursor of another survey, 401 and 404 as the server", async () => {
    const { call } = setupSandbox();
    const cursor = (
      await (await call(`${results(SURVEYS.feedback)}?limit=1`, { user: USERS.owner })).json()
    ).nextCursor;
    const other = await call(`${results(SURVEYS.campaign)}?cursor=${cursor}`, {
      user: USERS.owner,
    });
    expect(other.status).toBe(400);
    expect(await other.json()).toMatchObject({ detail: "Invalid cursor." });
    expect((await call(`${results(SURVEYS.feedback)}?limit=0`, { user: USERS.owner })).status).toBe(
      400,
    );
    expect((await call(results(SURVEYS.feedback))).status).toBe(401);
    expect((await call(results(SURVEYS.feedback), { user: USERS.member })).status).toBe(404);
    // The results lists take 1 to 1000 (the contract's own limit, not the shared 1 to 200).
    expect(
      (await call(`${results(SURVEYS.feedback)}?limit=1000`, { user: USERS.owner })).status,
    ).toBe(200);
    expect(
      (await call(`${results(SURVEYS.feedback)}?limit=1001`, { user: USERS.owner })).status,
    ).toBe(400);
    // A project member may read the results.
    expect((await call(results(SURVEYS.campaign), { user: USERS.member })).status).toBe(200);
  });
});

describe("getResultStats", () => {
  it("counts the responses with the first and last submission time", async () => {
    const { call } = setupSandbox();
    const stats = await (
      await call(`${results(SURVEYS.feedback)}/stats`, { user: USERS.owner })
    ).json();
    expect(stats).toStrictEqual({
      count: 5,
      firstSubmittedAt: "2026-04-01T08:00:00.500Z",
      lastSubmittedAt: "2026-04-01T12:00:00.000Z",
    });
    const none = await (
      await call(`${results(SURVEYS.draft)}/stats`, { user: USERS.owner })
    ).json();
    expect(none).toStrictEqual({ count: 0, firstSubmittedAt: null, lastSubmittedAt: null });
    expect((await call(`${results(SURVEYS.feedback)}/stats`, { user: USERS.member })).status).toBe(
      404,
    );
  });
});

describe("deleteResults", () => {
  it("removes the responses, markers and respondent files but not the editor's assets", async () => {
    const { call, ctx } = setupSandbox();
    ctx.store.write((data) => {
      data.files.push(
        {
          id: "a".repeat(64),
          surveyId: SURVEYS.feedback,
          kind: "asset",
          name: "a.png",
          contentType: "image/png",
          size: 1,
          base64: "AA==",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "b".repeat(64),
          surveyId: SURVEYS.feedback,
          kind: "respondent",
          name: "b.pdf",
          contentType: "application/octet-stream",
          size: 1,
          base64: "AA==",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      );
    });
    const response = await call(results(SURVEYS.feedback), { method: "DELETE", user: USERS.owner });
    expect(response.status).toBe(204);
    const stats = await (
      await call(`${results(SURVEYS.feedback)}/stats`, { user: USERS.owner })
    ).json();
    expect(stats.count).toBe(0);
    const data = ctx.store.read();
    expect(data.completions[SURVEYS.feedback]).toBeUndefined();
    expect(data.files.map((f) => f.name)).toEqual(["a.png"]);
    expect((await call(`/public/files/${"b".repeat(64)}`)).status).toBe(404);
    expect((await call(`/public/files/${"a".repeat(64)}`)).status).toBe(200);
    // The survey can be answered again by the same client.
    expect(
      await (await call(`/public/surveys/${SURVEYS.feedback}?clientId=client-0001`)).json(),
    ).toMatchObject({ completed: false });
  });

  it("removes the survey's idempotency keys with its responses", async () => {
    const { call, ctx } = setupSandbox();
    const submitted = await call(`/public/surveys/${SURVEYS.feedback}/responses`, {
      method: "POST",
      json: { data: { satisfaction: 4 } },
      headers: { "Idempotency-Key": "key-1" },
    });
    expect(submitted.status).toBe(201);
    expect(ctx.store.read().idempotencyKeys[SURVEYS.feedback]).toBeDefined();
    const response = await call(results(SURVEYS.feedback), { method: "DELETE", user: USERS.owner });
    expect(response.status).toBe(204);
    expect(ctx.store.read().idempotencyKeys[SURVEYS.feedback]).toBeUndefined();
  });

  it("needs modify rights: 403 for a member who neither administers nor created it, 404 when invisible, 401 signed out", async () => {
    const { call } = setupSandbox();
    expect(
      (await call(results(SURVEYS.archivedCampaign), { method: "DELETE", user: USERS.member }))
        .status,
    ).toBe(403);
    expect(
      (await call(results(SURVEYS.feedback), { method: "DELETE", user: USERS.member })).status,
    ).toBe(404);
    expect((await call(results(SURVEYS.feedback), { method: "DELETE" })).status).toBe(401);
    const stats = await (
      await call(`${results(SURVEYS.campaign)}/stats`, { user: USERS.owner })
    ).json();
    expect(stats.count).toBe(5);
  });
});
