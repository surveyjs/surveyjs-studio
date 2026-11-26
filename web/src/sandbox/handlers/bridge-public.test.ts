// The bridge's public operations (ADR 0039 point 2) in the sandbox.
import { describe, expect, it } from "vitest";
import { seed, setupSandbox, SURVEYS, USERS } from "./testing";

const post = (n: number) => `33333333-0000-4000-8000-a0000000000${n}`;
const result = (n: number) => `44444444-0000-4000-8000-a0000000000${n}`;

const submit = (surveyId: string, body: unknown) => ({
  path: `/public/surveys/${surveyId}/responses`,
  init: { method: "POST", json: body },
});

const byPost = (postId: string, body: unknown, headers: Record<string, string> = {}) => ({
  path: `/public/posts/${postId}/responses`,
  init: { method: "POST", json: body, headers },
});

describe("getPublicDefinition", () => {
  it("serves the working definition of an unpublished survey with a strong ETag, and revalidates", async () => {
    const { call } = setupSandbox({}, "hosted");
    const path = `/public/surveys/${SURVEYS.oldPoll}/definition`;
    const first = await call(path);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[^"]+"$/);
    expect(await first.json()).toStrictEqual(seed.definitions[SURVEYS.oldPoll] ?? {});

    for (const match of [etag, `"other", ${etag}`, "*", `W/${etag}`]) {
      const same = await call(path, { headers: { "If-None-Match": match } });
      expect(same.status, match).toBe(304);
      expect(same.headers.get("etag")).toBe(etag);
      expect(same.headers.get("cache-control")).toBe("no-cache");
      expect(await same.text()).toBe("");
    }
    expect((await call(path, { headers: { "If-None-Match": '"stale"' } })).status).toBe(200);

    const saved = await call(`/surveys/${SURVEYS.oldPoll}/definition`, {
      method: "PUT",
      user: USERS.owner,
      json: { title: "Edited" },
      headers: { "If-Match": etag },
    });
    expect(saved.status).toBe(204);
    const changed = await call(path, { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(await changed.json()).toStrictEqual({ title: "Edited" });
  });

  it("serves an archived survey and answers 404 for an unknown one", async () => {
    const { call } = setupSandbox({}, "hosted");
    expect((await call(`/public/surveys/${SURVEYS.archivedCampaign}/definition`)).status).toBe(200);
    const unknown = await call("/public/surveys/nope/definition");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "survey-not-available" });
  });
});

describe("getRespondentState", () => {
  it("reads the marker by survey ID and by result ID, percent-decoded", async () => {
    const { call } = setupSandbox({}, "hosted");
    const state = async (path: string) =>
      ((await (await call(path)).json()) as { state: string }).state;
    const id = encodeURIComponent("a b%");
    expect(await state(`/public/surveys/${SURVEYS.feedback}/respondents/${id}`)).toBe("none");
    // The seed's marker of client-0001 is partial.
    expect(await state(`/public/surveys/${SURVEYS.feedback}/respondents/client-0001`)).toBe(
      "partial",
    );
    expect(await state(`/public/results/${result(1)}/respondents/client-0001`)).toBe("partial");
    // A survey that is not published still answers.
    expect(await state(`/public/surveys/${SURVEYS.oldPoll}/respondents/x`)).toBe("none");
  });

  it("answers 404 for an unknown survey or result ID and 400 for a long client ID", async () => {
    const { call } = setupSandbox({}, "hosted");
    for (const path of [
      "/public/surveys/nope/respondents/c",
      "/public/results/nope/respondents/c",
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(await response.json()).toMatchObject({ code: "survey-not-available" });
    }
    const long = await call(`/public/surveys/${SURVEYS.feedback}/respondents/${"c".repeat(257)}`);
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ errors: [{ pointer: "/clientId" }] });
  });
});

describe("submitResponseByPostId", () => {
  it("stores a response for an unpublished survey, once per Idempotency-Key", async () => {
    const { call } = setupSandbox({}, "hosted");
    const refused = submit(SURVEYS.oldPoll, { data: { q: 1 } });
    expect((await call(refused.path, refused.init)).status).toBe(404);
    const headers = { "Idempotency-Key": "k1" };
    const first = byPost(post(3), { data: { q: 1 } }, headers);
    const created = await call(first.path, first.init);
    expect(created.status).toBe(201);
    const again = byPost(post(3), { data: { q: 2 } }, headers);
    const replay = await call(again.path, again.init);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { id: string }).id).toBe(
      ((await created.json()) as { id: string }).id,
    );
  });

  it("stores a completed client's next post, and the marker follows it", async () => {
    const { call } = setupSandbox({}, "hosted");
    const body = { data: { satisfaction: 5 }, clientId: "limited-client" };
    const state = async () =>
      (
        (await (
          await call(`/public/surveys/${SURVEYS.feedback}/respondents/limited-client`)
        ).json()) as { state: string }
      ).state;
    const send = (extra: object = {}) => {
      const request = byPost(post(1), { ...body, ...extra });
      return call(request.path, request.init);
    };
    expect((await send()).status).toBe(201);
    // The run page's route refuses a second completion; the old post does not.
    const run = submit(SURVEYS.feedback, body);
    expect((await call(run.path, run.init)).status).toBe(409);
    expect((await send()).status).toBe(201);
    expect(await state()).toBe("completed");
    expect((await send({ partial: true })).status).toBe(201);
    expect(await state()).toBe("partial");
  });

  it("answers 404 for an unknown post ID and 422 for a bad body", async () => {
    const { call } = setupSandbox({}, "hosted");
    const unknown = byPost("nope", { data: {} });
    const response = await call(unknown.path, unknown.init);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "survey-not-available" });
    const bad = byPost(post(1), {});
    expect((await call(bad.path, bad.init)).status).toBe(422);
  });
});

describe("getQuestionSummary", () => {
  it("counts the completed responses only, by result ID", async () => {
    const { call } = setupSandbox({}, "hosted");
    const send = async (data: object, extra: object = {}) => {
      const request = byPost(post(2), { data, ...extra });
      expect((await call(request.path, request.init)).status).toBe(201);
    };
    await send({ q1: ["a", "b"] });
    await send({ q1: ["b"] });
    await send({ q1: { r1: "c1" } });
    await send({ q1: 1 });
    await send({ q1: "1" });
    await send({ other: "x" });
    await send({ q1: "p" }, { clientId: "p1", partial: true });
    await send({ q1: "run" }, { clientId: "c1", partial: true });
    await send({ q1: ["a"] }, { clientId: "c1" });

    const response = await call(`/public/results/${result(2)}/questions/q1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      answered: 6,
      values: [
        { value: "a", count: 2 },
        { value: "b", count: 2 },
        { value: ["r1", "c1"], count: 1 },
        { value: 1, count: 1 },
        { value: "1", count: 1 },
      ],
    });
    expect(body["responseCount"]).toBeGreaterThanOrEqual(7);
    expect(typeof body["firstSubmittedAt"]).toBe("string");
  });

  it("answers an empty summary without responses, 404 for an unknown result ID and 400 for a long name", async () => {
    const { call } = setupSandbox({}, "hosted");
    const empty = await call(`/public/results/${result(3)}/questions/${encodeURIComponent("q 1")}`);
    expect(await empty.json()).toStrictEqual({
      answered: 0,
      values: [],
      responseCount: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });
    expect((await call("/public/results/nope/questions/q")).status).toBe(404);
    const long = await call(`/public/results/${result(3)}/questions/${"q".repeat(257)}`);
    expect(long.status).toBe(400);
  });
});

describe("getPublicResults from and till", () => {
  const path = `/public/surveys/${SURVEYS.feedback}/results`;

  it("keeps responses strictly between them, as instants, paging inside the range", async () => {
    const { call } = setupSandbox({}, "hosted");
    // The survey's private questions name HappendAt, so its public items carry no time: the
    // completed responses' times come from the seed.
    const times = (seed.responses[SURVEYS.feedback] ?? [])
      .filter((response) => !response.partial)
      .map((response) => response.submittedAt);
    const all = (await (await call(path)).json()) as { items: unknown[] };
    expect(all.items).toHaveLength(times.length);
    expect(times.length).toBeGreaterThanOrEqual(3);
    const [first, second] = times as [string, string];
    const query = async (q: string) =>
      (await (await call(`${path}?${q}`)).json()) as {
        items: unknown[];
        nextCursor: string | null;
      };
    expect((await query(`from=${encodeURIComponent(first)}`)).items).toHaveLength(times.length - 1);
    expect((await query(`till=${encodeURIComponent(second)}`)).items).toHaveLength(1);
    // The same instant written with an offset still counts as a bound.
    const shifted = new Date(Date.parse(second) + 3_600_000).toISOString().replace("Z", "+01:00");
    expect((await query(`till=${encodeURIComponent(shifted)}`)).items).toHaveLength(1);
    const paged = await query(`from=${encodeURIComponent(first)}&limit=1`);
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
  });

  it("refuses a from or till that is not a date-time or that Date cannot read", async () => {
    const { call } = setupSandbox({}, "hosted");
    for (const q of [
      "from=yesterday",
      "till=2026-04-01",
      "from=2026-13-01T00:00:00Z",
      "from=2026-02-30T00:00:00Z",
      "from=2026-04-01T23:59:60Z",
    ]) {
      const response = await call(`${path}?${q}`);
      expect(response.status, q).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "bad-request",
        errors: [{ detail: 'must match format "date-time"' }],
      });
    }
  });
});

describe("getLegacyFile", () => {
  it("answers 404 not-found for every name: the sandbox keeps no legacy files", async () => {
    const { call } = setupSandbox({}, "hosted");
    for (const path of ["asset/abc", "response/abc.png", "image/abc", "asset/..%2Fx"]) {
      const response = await call(`/public/legacy-files/${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not-found" });
    }
  });
});

describe("getPublicLayout", () => {
  const publicLayout = (id: string, kind: string) => `/public/surveys/${id}/layouts/${kind}`;

  it("serves the layout text and the private question names while public results are on", async () => {
    const { call } = setupSandbox({}, "hosted");
    const response = await call(publicLayout(SURVEYS.feedback, "table"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { text: string; privateQuestions: string[] };
    expect(Object.keys(body)).toEqual(["text", "privateQuestions"]);
    expect(body.privateQuestions).toEqual(["receipt", "HappendAt", "InstanceId"]);
    expect(JSON.parse(body.text)).toMatchObject({ pageSize: 10 });
  });

  it("answers 404 survey-not-available when public results are off, 400 for a bad kind", async () => {
    const { call } = setupSandbox({}, "hosted");
    const patch = {
      method: "PATCH",
      user: USERS.owner,
      json: { settings: { publicResults: false } },
    };
    expect((await call(publicLayout(SURVEYS.feedback, "summary"))).status).toBe(200);
    const none = await (await call(publicLayout(SURVEYS.feedback, "columns"))).json();
    expect(none.text).not.toBeNull();
    expect((await call(`/surveys/${SURVEYS.feedback}`, patch)).status).toBe(200);
    const off = await call(publicLayout(SURVEYS.feedback, "summary"));
    expect(off.status).toBe(404);
    expect(await off.json()).toMatchObject({ code: "survey-not-available" });
    expect((await call(publicLayout(SURVEYS.feedback, "charts"))).status).toBe(400);
    expect((await call(publicLayout("nope", "table"))).status).toBe(404);
  });

  it("is not routed outside the hosted edition", async () => {
    const { call } = setupSandbox();
    const response = await call(publicLayout(SURVEYS.feedback, "table"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not-found" });
  });
});
