/**
 * `getResultsView`, `saveResultsView` and `resetResultsView` against the legacy fixtures.
 *
 * The data is shared by all test files and never reset, so every test that writes a layout creates
 * its own survey (in the admin's Personal scope, or in Engineering for the per-user test) and
 * writes only there. The fixture surveys `…a01` and `…a08` are read only: no view goes to them;
 * the checks on them are reads and refusals. Cleanup (archive, then delete) is registered with
 * `onTestFinished` right after a survey is created.
 */
import { describe, expect, it, onTestFinished } from "vitest";
import { call, codeOf, as, cleanUp, ownsServer } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const LARGE = "22222222-0000-4000-8000-a00000000008";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";

const VIEW = "/surveys/{surveyId}/views/{view}";

type Headers = Record<string, string>;

/** Creates a survey with the body and registers its cleanup by the same caller. */
async function created(headers: Headers, body: Record<string, unknown> = {}): Promise<string> {
  const response = await call("POST", "/surveys", { headers, body });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(() => cleanUp(headers, id));
  return id;
}

const get = (surveyId: string, view: string, headers?: Headers) =>
  call("GET", VIEW, { path: `/surveys/${surveyId}/views/${view}`, ...(headers && { headers }) });

const put = (surveyId: string, view: string, headers: Headers | undefined, body?: unknown) =>
  call("PUT", VIEW, {
    path: `/surveys/${surveyId}/views/${view}`,
    ...(headers && { headers }),
    ...(body !== undefined && { body }),
  });

const reset = (surveyId: string, view: string, headers?: Headers) =>
  call("DELETE", VIEW, {
    path: `/surveys/${surveyId}/views/${view}`,
    ...(headers && { headers }),
  });

async function expectViewNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "view-not-found", title: "View not found" });
}

async function updatedAtOf(surveyId: string, headers: Headers): Promise<string> {
  const response = await call("GET", "/surveys/{surveyId}", {
    path: `/surveys/${surveyId}`,
    headers,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { updatedAt: string }).updatedAt;
}

// The fixture layouts of survey …a01, as the legacy blobs hold them.
const LEGACY_SUMMARY = {
  elements: [
    { name: "satisfaction", isPublic: true },
    { name: "receipt", isPublic: false },
  ],
};
const LEGACY_TABLE = {
  locale: "",
  elements: [
    {
      name: "satisfaction",
      displayName: "How satisfied are you?",
      isVisible: true,
      isPublic: true,
    },
    { name: "receipt", displayName: "Upload your receipt", isVisible: true, isPublic: false },
  ],
  pageSize: 10,
};

describe("views", () => {
  it("saves, reads and resets a layout without touching the survey", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    const before = await updatedAtOf(surveyId, adam);
    await expectViewNotFound(await get(surveyId, "summary", adam));

    const summary = { elements: [{ name: "q1", isVisible: false }], text: "Ünïcødé 😀" };
    expect((await put(surveyId, "summary", adam, summary)).status).toBe(204);
    const saved = await get(surveyId, "summary", adam);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toStrictEqual(summary);

    expect((await put(surveyId, "table", adam, { pageSize: 25 })).status).toBe(204);
    expect(await (await get(surveyId, "summary", adam)).json()).toStrictEqual(summary);

    expect((await reset(surveyId, "summary", adam)).status).toBe(204);
    await expectViewNotFound(await get(surveyId, "summary", adam));
    expect((await reset(surveyId, "summary", adam)).status).toBe(204);
    expect(await (await get(surveyId, "table", adam)).json()).toStrictEqual({ pageSize: 25 });

    expect(await updatedAtOf(surveyId, adam)).toBe(before);
  });

  it("keeps layouts per user", async (ctx) => {
    const adam = await as(ctx, admin);
    const olivia = await as(ctx, owner);
    const surveyId = await created(adam, { projectId: ENGINEERING });
    const his = { elements: [{ name: "q1", isVisible: false }] };
    const hers = { elements: [{ name: "q1", isVisible: true }] };

    expect((await put(surveyId, "summary", adam, his)).status).toBe(204);
    await expectViewNotFound(await get(surveyId, "summary", olivia));
    expect((await put(surveyId, "summary", olivia, hers)).status).toBe(204);
    expect(await (await get(surveyId, "summary", olivia)).json()).toStrictEqual(hers);
    expect(await (await get(surveyId, "summary", adam)).json()).toStrictEqual(his);

    expect((await reset(surveyId, "summary", olivia)).status).toBe(204);
    await expectViewNotFound(await get(surveyId, "summary", olivia));
    expect(await (await get(surveyId, "summary", adam)).json()).toStrictEqual(his);
  });

  it("serves the legacy layouts of a survey until the user saves or resets", async (ctx) => {
    const olivia = await as(ctx, owner);
    const summary = await get(FEEDBACK, "summary", olivia);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toStrictEqual(LEGACY_SUMMARY);
    const table = await get(FEEDBACK, "table", olivia);
    expect(table.status).toBe(200);
    expect(await table.json()).toStrictEqual(LEGACY_TABLE);
  });

  it("does not copy layouts to a clone", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    expect((await put(surveyId, "summary", adam, { a: 1 })).status).toBe(204);
    const response = await call("POST", "/surveys/{surveyId}/clones", {
      path: `/surveys/${surveyId}/clones`,
      headers: adam,
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    onTestFinished(() => cleanUp(adam, id));
    await expectViewNotFound(await get(id, "summary", adam));
  });

  it("refuses a body that is not a JSON object, or not JSON at all", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    for (const rawBody of ["[]", '"x"', "5", "null"]) {
      const response = await call("PUT", VIEW, {
        path: `/surveys/${surveyId}/views/summary`,
        headers: adam,
        rawBody,
      });
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    const plain = await call("PUT", VIEW, {
      path: `/surveys/${surveyId}/views/summary`,
      headers: { ...adam, "content-type": "text/plain" },
      rawBody: "{}",
    });
    expect(plain.status).toBe(415);
    const malformed = await call("PUT", VIEW, {
      path: `/surveys/${surveyId}/views/summary`,
      headers: adam,
      rawBody: "{",
    });
    expect(malformed.status).toBe(400);
    const empty = await put(surveyId, "summary", adam);
    expect(empty.status).toBe(422);
    await expectViewNotFound(await get(surveyId, "summary", adam));
  });

  it("refuses a body over limits.maxResponseBytes", async (ctx) => {
    const config = await call("GET", "/config");
    const limit = ((await config.json()) as { limits: { maxResponseBytes: number } }).limits
      .maxResponseBytes;
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    const frame = JSON.stringify({ t: "" });
    const rawBody = JSON.stringify({ t: "x".repeat(limit + 1 - frame.length) });
    expect(Buffer.byteLength(rawBody)).toBe(limit + 1);
    const response = await call("PUT", VIEW, {
      path: `/surveys/${surveyId}/views/summary`,
      headers: adam,
      rawBody,
    });
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("payload-too-large");
    // The server reads a small overflow to its end and keeps the connection; with Connection: close
    // it would cut the connection while the client is still sending, and the client could see
    // EPIPE instead of this answer.
    // Only the reference server is checked: a proxy in front decides this hop-by-hop header.
    if (ownsServer) expect(response.headers.get("connection")).not.toBe("close");
  });

  it("refuses an unknown view, a missing CSRF token and a missing session", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    expect((await get(surveyId, "charts", adam)).status).toBe(400);
    const { cookie = "" } = adam;
    for (const response of [
      await put(surveyId, "summary", { cookie }, {}),
      await reset(surveyId, "summary", { cookie }),
    ]) {
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("csrf-token-invalid");
    }
    expect((await get(surveyId, "summary")).status).toBe(401);
    expect((await put(surveyId, "summary", undefined, {})).status).toBe(401);
    expect((await reset(surveyId, "summary")).status).toBe(401);
  });

  it("answers 404 not-found to an outsider, on a colleague's survey and on a fixture", async (ctx) => {
    const adam = await as(ctx, admin);
    const oscar = await as(ctx, outsider);
    const surveyId = await created(adam);
    for (const id of [surveyId, LARGE]) {
      for (const response of [
        await get(id, "summary", oscar),
        await put(id, "summary", oscar, {}),
        await reset(id, "summary", oscar),
      ]) {
        expect(response.status).toBe(404);
        expect(await codeOf(response)).toBe("not-found");
      }
    }
  });
});
