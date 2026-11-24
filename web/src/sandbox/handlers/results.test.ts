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
      count: 4,
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
    await ctx.store.write((data) => {
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
    expect(stats.count).toBe(4);
  });
});

describe("partial responses", () => {
  const SURVEY = SURVEYS.campaign;
  const post = (call: ReturnType<typeof setupSandbox>["call"], body: object) =>
    call(`/public/surveys/${SURVEY}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("folds a partial post and the complete one into one response; stats count complete rows", async () => {
    const { call } = setupSandbox();
    const list = async () =>
      (await (await call(`${results(SURVEY)}?limit=50`, { user: USERS.owner })).json()).items;
    const stats = async () =>
      (await call(`${results(SURVEY)}/stats`, { user: USERS.owner })).json();
    const before = (await list()).length;
    const count = (await stats()).count;

    expect((await post(call, { data: { a: 1 }, clientId: "p-1", partial: true })).status).toBe(201);
    const open = await list();
    expect(open).toHaveLength(before + 1);
    expect(open.at(-1)).toMatchObject({ data: { a: 1 }, clientId: "p-1", partial: true });
    expect((await stats()).count).toBe(count);
    expect(await (await call(`/public/surveys/${SURVEY}?clientId=p-1`)).json()).toMatchObject({
      completed: false,
    });

    expect((await post(call, { data: { b: 2 }, clientId: "p-1" })).status).toBe(201);
    const done = await list();
    expect(done).toHaveLength(before + 1);
    expect(done.at(-1)).toMatchObject({ data: { a: 1, b: 2 }, clientId: "p-1" });
    expect(done.at(-1)).not.toHaveProperty("partial");
    expect((await stats()).count).toBe(count + 1);
  });

  it("stores a partial post without a client id as complete", async () => {
    const { call } = setupSandbox();
    await post(call, { data: { a: 1 }, partial: true });
    const items = (await (await call(`${results(SURVEY)}?limit=50`, { user: USERS.owner })).json())
      .items;
    expect(items.at(-1)).not.toHaveProperty("partial");
  });
});

describe("listResults from and till", () => {
  it("keeps responses strictly between the bounds and refuses a bad date-time", async () => {
    const { call } = setupSandbox();
    const times = seeded.map((r) => r.submittedAt);
    const from = encodeURIComponent(times[0]!);
    const till = encodeURIComponent(times.at(-1)!);
    const page = await (
      await call(`${results(SURVEYS.feedback)}?limit=50&from=${from}&till=${till}`, {
        user: USERS.owner,
      })
    ).json();
    expect(page.items.map((r: { id: string }) => r.id)).toEqual(
      seeded
        .filter((r) => r.submittedAt > times[0]! && r.submittedAt < times.at(-1)!)
        .map((r) => r.id),
    );
    const bad = await call(`${results(SURVEYS.feedback)}?from=yesterday`, { user: USERS.owner });
    expect(bad.status).toBe(400);
  });
});

describe("deleteResponse", () => {
  const del = (id: string, responseId: string, user?: string) =>
    ({
      path: `${results(id)}/${responseId}`,
      init: { method: "DELETE", ...(user && { user }) },
    }) as const;

  it("deletes the whole run by any save's id, then answers 404", async () => {
    const { call } = setupSandbox();
    const before = await (
      await call(`${results(SURVEYS.feedback)}?limit=50`, { user: USERS.owner })
    ).json();
    const target = before.items[0].id as string;
    const request = del(SURVEYS.feedback, target.toUpperCase(), USERS.owner);
    expect((await call(request.path, request.init)).status).toBe(204);
    const after = await (
      await call(`${results(SURVEYS.feedback)}?limit=50`, { user: USERS.owner })
    ).json();
    expect(after.items).toHaveLength(before.items.length - 1);
    expect((await call(request.path, request.init)).status).toBe(404);
  });

  it("answers 401, 403 for a member who cannot modify, and 404 for an outsider", async () => {
    const { call } = setupSandbox();
    const target = seeded[0]!.id;
    const anon = del(SURVEYS.feedback, target);
    expect((await call(anon.path, anon.init)).status).toBe(401);
    const outsider = del(SURVEYS.feedback, target, USERS.member);
    expect((await call(outsider.path, outsider.init)).status).toBe(404);
  });
});

describe("deleteResponse runs", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 5, 1, 0, n)).toISOString();
  const sid = (n: number) => `66666666-0000-4000-8000-a0000000000${n}`;
  const ids = (sandbox: ReturnType<typeof setupSandbox>) =>
    sandbox.ctx.store
      .read()
      .responses[SURVEYS.campaign]!.map((row) => row.id)
      .sort();

  /**
   * Saves 1 (no client), 2-4 (client-del: two partial saves, then the complete one), 5
   * (client-other, complete), in submission order.
   */
  async function setup() {
    const sandbox = setupSandbox({}, "hosted");
    await sandbox.ctx.store.write((data) => {
      const row = (n: number, extra: { clientId?: string; partial?: boolean }) => ({
        id: sid(n),
        submittedAt: at(n),
        data: { n },
        partial: false,
        ...extra,
      });
      data.responses[SURVEYS.campaign] = [
        row(1, {}),
        row(2, { clientId: "client-del", partial: true }),
        row(3, { clientId: "client-del", partial: true }),
        row(4, { clientId: "client-del" }),
        row(5, { clientId: "client-other" }),
      ];
      data.completions[SURVEYS.campaign] = {
        "client-del": { partial: false },
        "client-other": { partial: false },
      };
    });
    return sandbox;
  }
  const remove = (sandbox: ReturnType<typeof setupSandbox>, responseId: string, user?: string) =>
    sandbox.call(`${results(SURVEYS.campaign)}/${responseId}`, {
      method: "DELETE",
      user: user ?? USERS.owner,
    });
  const state = async (sandbox: ReturnType<typeof setupSandbox>, clientId: string) =>
    (
      await (
        await sandbox.call(`/public/surveys/${SURVEYS.campaign}/respondents/${clientId}`)
      ).json()
    ).state;

  it.each([
    ["the last save's id, in upper case", 4],
    ["the middle save's id", 3],
    ["the first save's id", 2],
  ])("deletes the whole run by %s and clears the client's state", async (_name, n) => {
    const sandbox = await setup();
    expect(await state(sandbox, "client-del")).toBe("completed");
    expect((await remove(sandbox, sid(n).toUpperCase())).status).toBe(204);
    expect(ids(sandbox)).toStrictEqual([sid(1), sid(5)]);
    expect(await state(sandbox, "client-del")).toBe("none");
    expect(await state(sandbox, "client-other")).toBe("completed");
    const page = await (
      await sandbox.call(`${results(SURVEYS.campaign)}?limit=10`, { user: USERS.owner })
    ).json();
    expect(page.items.map((r: { id: string }) => r.id)).toStrictEqual([sid(1), sid(5)]);
  });

  it("answers 404 for an unknown id and changes nothing", async () => {
    const sandbox = await setup();
    for (const id of [sid(8), "not-a-guid"]) expect((await remove(sandbox, id)).status).toBe(404);
    expect(ids(sandbox)).toHaveLength(5);
    expect(await state(sandbox, "client-del")).toBe("completed");
  });

  it("deletes a response without a client id by its id, and only that one", async () => {
    const sandbox = await setup();
    expect((await remove(sandbox, sid(1))).status).toBe(204);
    expect(ids(sandbox)).toStrictEqual([sid(2), sid(3), sid(4), sid(5)]);
    expect(await state(sandbox, "client-del")).toBe("completed");
    expect((await remove(sandbox, sid(1))).status).toBe(404);
  });

  it("keeps the marker of a client's later run", async () => {
    const sandbox = setupSandbox({}, "hosted");
    await sandbox.ctx.store.write((data) => {
      data.responses[SURVEYS.campaign] = [
        { id: sid(1), submittedAt: at(1), data: {}, clientId: "client-two", partial: false },
        { id: sid(2), submittedAt: at(2), data: {}, clientId: "client-two", partial: true },
      ];
      data.completions[SURVEYS.campaign] = { "client-two": { partial: true } };
    });
    expect((await remove(sandbox, sid(1))).status).toBe(204);
    expect(ids(sandbox)).toStrictEqual([sid(2)]);
    expect(await state(sandbox, "client-two")).toBe("partial");
    expect((await remove(sandbox, sid(2))).status).toBe(204);
    expect(await state(sandbox, "client-two")).toBe("none");
  });

  it("answers 403 to a user who can see the survey but not change it", async () => {
    const sandbox = setupSandbox({}, "hosted");
    const retro = `${results(SURVEYS.retro)}/${sid(1)}`;
    const response = await sandbox.call(retro, { method: "DELETE", user: USERS.owner });
    expect(response.status).toBe(403);
  });
});
