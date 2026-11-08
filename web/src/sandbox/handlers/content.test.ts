import { describe, expect, it } from "vitest";
import { HISTORY_SNAPSHOTS } from "./history";
import { seed, setupSandbox, SURVEYS, USERS, type Sandbox } from "./testing";

const put = (json: unknown, ifMatch?: string) => ({
  method: "PUT",
  json,
  ...(ifMatch !== undefined && { headers: { "If-Match": ifMatch } }),
});

/** The ETag the server would give: `"` + base64url SHA-256 of JSON.stringify(content) + `"`. */
async function etagOf(content: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const base64 = btoa(String.fromCharCode(...digest));
  return `"${base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}"`;
}

describe("survey definition", () => {
  it("GET answers the definition with a strong ETag of its JSON and no-transform", async () => {
    const { call } = setupSandbox();
    const response = await call(`/surveys/${SURVEYS.feedback}/definition`, { user: USERS.owner });
    expect(response.status).toBe(200);
    const definition = await response.json();
    expect(definition).toEqual(seed.definitions[SURVEYS.feedback]);
    expect(response.headers.get("etag")).toBe(await etagOf(definition));
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(response.headers.get("cache-control")).toBe("no-transform");
  });

  it("answers {} for a survey without a definition", async () => {
    const { call } = setupSandbox();
    const response = await call(`/surveys/${SURVEYS.draft}/definition`, { user: USERS.owner });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("PUT with the current ETag answers 204 and the new ETag; the old one then gets 412", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/definition`;
    const old = (await call(path, { user: USERS.owner })).headers.get("etag")!;
    const saved = await call(path, { ...put({ title: "Changed" }, old), user: USERS.owner });
    expect(saved.status).toBe(204);
    expect(saved.headers.get("etag")).toBe(await etagOf({ title: "Changed" }));
    expect(saved.headers.get("etag")).not.toBe(old);

    const read = await call(path, { user: USERS.owner });
    expect(await read.json()).toEqual({ title: "Changed" });
    expect(read.headers.get("etag")).toBe(saved.headers.get("etag"));

    const stale = await call(path, { ...put({ title: "Stale" }, old), user: USERS.owner });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({
      code: "edit-conflict",
      title: "The survey was changed by someone else",
    });
    expect(await (await call(path, { user: USERS.owner })).json()).toEqual({ title: "Changed" });
  });

  it("PUT without If-Match answers 428; * matches any version; weak tags and garbage do not", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/definition`;
    const missing = await call(path, { ...put({ a: 1 }), user: USERS.owner });
    expect(missing.status).toBe(428);
    expect(await missing.json()).toMatchObject({ code: "if-match-required" });
    expect((await call(path, { ...put({ a: 1 }, "  "), user: USERS.owner })).status).toBe(428);

    const current = (await call(path, { user: USERS.owner })).headers.get("etag")!;
    expect((await call(path, { ...put({ a: 1 }, `W/${current}`), user: USERS.owner })).status).toBe(
      412,
    );
    expect((await call(path, { ...put({ a: 1 }, "garbage"), user: USERS.owner })).status).toBe(412);
    expect(
      (await call(path, { ...put({ a: 1 }, `"x", ${current}`), user: USERS.owner })).status,
    ).toBe(204);
    expect((await call(path, { ...put({ a: 2 }, "*"), user: USERS.owner })).status).toBe(204);
  });

  it("PUT moves updatedAt and a first save of a survey without a definition works from its ETag", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.draft}/definition`;
    const tag = (await call(path, { user: USERS.owner })).headers.get("etag")!;
    expect((await call(path, { ...put({ title: "T" }, tag), user: USERS.owner })).status).toBe(204);
    const survey = await (await call(`/surveys/${SURVEYS.draft}`, { user: USERS.owner })).json();
    expect(survey.updatedAt > "2026-08-01").toBe(true);
  });

  it("PUT answers 403 without modify rights, 404 for a survey the user cannot see, 422 for a non-object", async () => {
    const { call } = setupSandbox();
    expect(
      (
        await call(`/surveys/${SURVEYS.archivedCampaign}/definition`, {
          ...put({}, "*"),
          user: USERS.member,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/surveys/${SURVEYS.feedback}/definition`, {
          ...put({}, "*"),
          user: USERS.member,
        })
      ).status,
    ).toBe(404);
    const array = await call(`/surveys/${SURVEYS.feedback}/definition`, {
      ...put([1], "*"),
      user: USERS.owner,
    });
    expect(array.status).toBe(422);
    expect((await call(`/surveys/${SURVEYS.feedback}/definition`, put({}, "*"))).status).toBe(401);
  });

  it("GET answers 404 for a survey the user cannot see and for an unknown one", async () => {
    const { call } = setupSandbox();
    expect(
      (await call(`/surveys/${SURVEYS.feedback}/definition`, { user: USERS.member })).status,
    ).toBe(404);
    expect((await call("/surveys/nope/definition", { user: USERS.owner })).status).toBe(404);
    // A project member may read the definition.
    expect(
      (await call(`/surveys/${SURVEYS.campaign}/definition`, { user: USERS.member })).status,
    ).toBe(200);
  });
});

describe("definition saves and history", () => {
  it("keeps the saved JSON on the newest entries only", async () => {
    const { call, ctx } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/definition`;
    const save = async (json: unknown) =>
      (await call(path, { ...put(json, "*"), user: USERS.owner })).status;
    const before = ctx.store.read().history[SURVEYS.feedback]!.length;

    for (let n = 1; n <= HISTORY_SNAPSHOTS + 2; n++) expect(await save({ n })).toBe(204);

    const entries = ctx.store.read().history[SURVEYS.feedback]!;
    expect(entries).toHaveLength(before + HISTORY_SNAPSHOTS + 2);
    const kept = entries.filter((entry) => entry.snapshot !== undefined);
    expect(kept.map((entry) => entry.snapshot)).toEqual(
      Array.from({ length: HISTORY_SNAPSHOTS }, (_, i) => ({ n: i + 3 })),
    );
  });
});

describe("GET /surveys/{id}/history/{entryId}", () => {
  const entryPath = (surveyId: string, entryId: string) =>
    `/surveys/${surveyId}/history/${entryId}`;
  const listIds = async (call: Sandbox["call"], surveyId: string) =>
    (
      (await (await call(`/surveys/${surveyId}/history`, { user: USERS.owner })).json()) as {
        items: { id: string }[];
      }
    ).items.map((item) => item.id);

  it("gives the definition each save stored, and the seed's legacy entries", async () => {
    const { call } = setupSandbox();
    const definition = `/surveys/${SURVEYS.feedback}/definition`;
    await call(definition, { ...put({ title: "One" }, "*"), user: USERS.owner });
    await call(definition, { ...put({ title: "Two" }, "*"), user: USERS.owner });

    const titles = [];
    for (const id of await listIds(call, SURVEYS.feedback)) {
      const response = await call(entryPath(SURVEYS.feedback, id.toUpperCase()), {
        user: USERS.owner,
      });
      expect(response.status).toBe(200);
      titles.push(((await response.json()) as { title: string }).title);
    }
    expect(titles.slice(0, 2)).toEqual(["Two", "One"]);
    // The two legacy entries share a time, so their order is the id tie-break.
    expect(titles.slice(2).sort()).toEqual(["Customer feedback", "Customer feedback (draft)"]);
  });

  it("answers 404 for an unknown entry, an entry of another survey and an invisible survey", async () => {
    const { call } = setupSandbox();
    const [feedbackEntry] = await listIds(call, SURVEYS.feedback);
    const unknown = "99999999-0000-4000-8000-a00000000099";
    for (const [surveyId, entryId, user] of [
      [SURVEYS.feedback, unknown, USERS.owner],
      [SURVEYS.draft, feedbackEntry!, USERS.owner],
      [SURVEYS.feedback, feedbackEntry!, USERS.member],
    ] as const) {
      const response = await call(entryPath(surveyId, entryId), { user });
      expect(response.status, `${surveyId} ${entryId} ${user}`).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not-found" });
    }
    expect((await call(entryPath(SURVEYS.feedback, feedbackEntry!))).status).toBe(401);
  });

  it("answers 501 with the reason for an entry older than the newest ones", async () => {
    const { call } = setupSandbox();
    const definition = `/surveys/${SURVEYS.feedback}/definition`;
    for (let n = 1; n <= HISTORY_SNAPSHOTS; n++) {
      await call(definition, { ...put({ n }, "*"), user: USERS.owner });
    }
    const ids = await listIds(call, SURVEYS.feedback);
    const oldest = await call(entryPath(SURVEYS.feedback, ids.at(-1)!), { user: USERS.owner });
    expect(oldest.status).toBe(501);
    expect(await oldest.json()).toMatchObject({
      code: "not-implemented",
      detail: `The demo keeps the JSON of the ${HISTORY_SNAPSHOTS} newest saves of a survey.`,
    });
    const newest = await call(entryPath(SURVEYS.feedback, ids[0]!), { user: USERS.owner });
    expect(await newest.json()).toEqual({ n: HISTORY_SNAPSHOTS });
  });
});

describe("survey theme", () => {
  it("GET and PUT work as the definition's, without a history entry", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/theme`;
    const read = await call(path, { user: USERS.owner });
    expect(read.status).toBe(200);
    const theme = await read.json();
    expect(theme).toEqual(seed.themes[SURVEYS.feedback]);
    const tag = read.headers.get("etag")!;
    expect(tag).toBe(await etagOf(theme));
    expect((await call(path, { ...put({ themeName: "x" }), user: USERS.owner })).status).toBe(428);
    const saved = await call(path, { ...put({ themeName: "x" }, tag), user: USERS.owner });
    expect(saved.status).toBe(204);
    expect(saved.headers.get("etag")).toBe(await etagOf({ themeName: "x" }));
    expect((await call(path, { ...put({ themeName: "y" }, tag), user: USERS.owner })).status).toBe(
      412,
    );
    const history = await (
      await call(`/surveys/${SURVEYS.feedback}/history`, { user: USERS.owner })
    ).json();
    expect(history.items).toHaveLength(seed.history[SURVEYS.feedback]!.length);
  });

  it("answers {} for a survey without a theme", async () => {
    const { call } = setupSandbox();
    const response = await call(`/surveys/${SURVEYS.campaign}/theme`, { user: USERS.admin });
    expect(await response.json()).toEqual({});
  });
});

describe("GET /surveys/{id}/history", () => {
  it("lists saves newest first, the author as {id, displayName}, and grows on every definition save", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/history`;
    const before = await (await call(path, { user: USERS.owner })).json();
    expect(before.items).toHaveLength(2);
    expect(before.items[0].user).toBeNull();

    const definition = `/surveys/${SURVEYS.feedback}/definition`;
    await call(definition, { ...put({ n: 1 }, "*"), user: USERS.owner });
    await call(definition, { ...put({ n: 2 }, "*"), user: USERS.owner });
    const after = await (await call(path, { user: USERS.owner })).json();
    expect(after.items).toHaveLength(4);
    expect(after.items[0].user).toEqual({ id: USERS.owner, displayName: "Olivia Owner" });
    const times: string[] = after.items.map((entry: { at: string }) => entry.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(Object.keys(after.items[0]).sort()).toEqual(["at", "id", "user"]);
    expect(new Set(after.items.map((entry: { id: string }) => entry.id)).size).toBe(4);
  });

  it("pages with cursors; a cursor of another kind or a bad one is 400", async () => {
    const { call } = setupSandbox();
    const path = `/surveys/${SURVEYS.feedback}/history`;
    const first = await (await call(`${path}?limit=1`, { user: USERS.owner })).json();
    expect(first.items).toHaveLength(1);
    const second = await (
      await call(`${path}?limit=1&cursor=${first.nextCursor}`, { user: USERS.owner })
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].at <= first.items[0].at).toBe(true);
    expect(second.nextCursor).toBeNull();
    const surveyCursor = (await (await call("/surveys?limit=1", { user: USERS.owner })).json())
      .nextCursor;
    for (const cursor of [surveyCursor, "garbage"]) {
      const response = await call(`${path}?cursor=${cursor}`, { user: USERS.owner });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ detail: "Invalid cursor." });
    }
  });

  it("answers 404 for a survey the user cannot see", async () => {
    const { call } = setupSandbox();
    expect(
      (await call(`/surveys/${SURVEYS.feedback}/history`, { user: USERS.member })).status,
    ).toBe(404);
  });
});
