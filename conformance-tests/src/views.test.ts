/**
 * `getResultsView`, `saveResultsView` and `resetResultsView`, and the shared layouts
 * (`getSurveyLayout`, `saveSurveyLayout`, `deleteSurveyLayout`), against the legacy fixtures.
 *
 * The data is shared by all test files and never reset, so every test that writes a layout creates
 * its own survey (in the admin's Personal scope, or in Engineering or Marketing for the tests of
 * several users) and writes only there. The fixture surveys `…a01` and `…a08` are read only: no
 * view or layout goes to them; the checks on them are reads and refusals. Cleanup (archive, then delete) is registered with
 * `onTestFinished` right after a survey is created.
 */
import { describe, expect, it, onTestFinished } from "vitest";
import { call, codeOf, as, cleanUp, ownsServer, sandbox } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

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
    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      const { cookie = "" } = adam;
      for (const response of [
        await put(surveyId, "summary", { cookie }, {}),
        await reset(surveyId, "summary", { cookie }),
      ]) {
        expect(response.status).toBe(403);
        expect(await codeOf(response)).toBe("csrf-token-invalid");
      }
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

const LAYOUT = "/surveys/{surveyId}/layouts/{kind}";
const MARKETING = "55555555-0000-4000-8000-a00000000001";

const getLayout = (surveyId: string, kind: string, headers?: Headers) =>
  call("GET", LAYOUT, {
    path: `/surveys/${surveyId}/layouts/${kind}`,
    ...(headers && { headers }),
  });

const putLayout = (surveyId: string, kind: string, headers: Headers | undefined, body?: unknown) =>
  call("PUT", LAYOUT, {
    path: `/surveys/${surveyId}/layouts/${kind}`,
    ...(headers && { headers }),
    ...(body !== undefined && { body }),
  });

const deleteLayout = (surveyId: string, kind: string, headers?: Headers) =>
  call("DELETE", LAYOUT, {
    path: `/surveys/${surveyId}/layouts/${kind}`,
    ...(headers && { headers }),
  });

async function expectLayoutNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    code: "layout-not-found",
    title: "Layout not found",
  });
}

/** The text of a layout read, which must succeed. */
async function layoutText(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const body = (await response.json()) as { text: string };
  expect(Object.keys(body)).toEqual(["text"]);
  return body.text;
}

describe("shared layouts", () => {
  // Whitespace and key order are part of the text, kept as given.
  const TEXT = ' {\n  "pageSize": 25,  "elements": [{ "name": "q1", "isVisible": false }] }\n';

  it("saves, reads verbatim and deletes each kind without touching the survey", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    const before = await updatedAtOf(surveyId, adam);
    for (const kind of ["table", "summary", "columns"]) {
      await expectLayoutNotFound(await getLayout(surveyId, kind, adam));
      expect((await putLayout(surveyId, kind, adam, { text: `${kind}${TEXT}` })).status).toBe(204);
    }
    for (const kind of ["table", "summary", "columns"]) {
      expect(await layoutText(await getLayout(surveyId, kind, adam))).toBe(`${kind}${TEXT}`);
    }
    expect((await putLayout(surveyId, "table", adam, { text: "Ünïcødé 😀" })).status).toBe(204);
    expect(await layoutText(await getLayout(surveyId, "table", adam))).toBe("Ünïcødé 😀");

    expect((await deleteLayout(surveyId, "table", adam)).status).toBe(204);
    await expectLayoutNotFound(await getLayout(surveyId, "table", adam));
    expect((await deleteLayout(surveyId, "table", adam)).status).toBe(204);
    expect(await layoutText(await getLayout(surveyId, "summary", adam))).toBe(`summary${TEXT}`);

    expect(await updatedAtOf(surveyId, adam)).toBe(before);
  });

  it("serves the fixture layouts of a survey", async (ctx) => {
    const olivia = await as(ctx, owner);
    const summary = await layoutText(await getLayout(FEEDBACK, "summary", olivia));
    expect(JSON.parse(summary)).toStrictEqual(LEGACY_SUMMARY);
    const table = await layoutText(await getLayout(FEEDBACK, "table", olivia));
    expect(JSON.parse(table)).toStrictEqual(LEGACY_TABLE);
    const columns = await layoutText(await getLayout(FEEDBACK, "columns", olivia));
    expect(JSON.parse(columns)).toMatchObject({ newcolumnsvisibility: 0 });
  });

  it("lets anyone who can see the survey read it, and only who can change it save", async (ctx) => {
    // Marketing: Adam and Olivia are admins, Mia a plain member; Oscar is outside.
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const oscar = await as(ctx, outsider);
    const surveyId = await created(adam, { projectId: MARKETING });
    expect((await putLayout(surveyId, "table", adam, { text: TEXT })).status).toBe(204);

    expect(await layoutText(await getLayout(surveyId, "table", mia))).toBe(TEXT);
    for (const response of [
      await putLayout(surveyId, "table", mia, { text: "{}" }),
      await deleteLayout(surveyId, "table", mia),
    ]) {
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("forbidden");
    }
    for (const response of [
      await getLayout(surveyId, "table", oscar),
      await putLayout(surveyId, "table", oscar, { text: "{}" }),
      await deleteLayout(surveyId, "table", oscar),
    ]) {
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
    expect(await layoutText(await getLayout(surveyId, "table", adam))).toBe(TEXT);
  });

  it("is the view of a user with no view of their own and no reset", async (ctx) => {
    // Review Focus 4: a layout saved for the survey, as the bridge saves the old table state.
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const olivia = await as(ctx, owner);
    const surveyId = await created(adam, { projectId: MARKETING });
    const shared = { elements: [{ name: "q1", isVisible: false }], pageSize: 5 };
    const text = JSON.stringify(shared, null, 2);
    expect((await putLayout(surveyId, "table", adam, { text })).status).toBe(204);
    const own = { pageSize: 50 };
    expect((await put(surveyId, "table", olivia, own)).status).toBe(204);
    expect((await reset(surveyId, "table", adam)).status).toBe(204);

    expect(await (await get(surveyId, "table", mia)).json()).toStrictEqual(shared);
    expect(await (await get(surveyId, "table", olivia)).json()).toStrictEqual(own);
    await expectViewNotFound(await get(surveyId, "table", adam));
    await expectViewNotFound(await get(surveyId, "summary", mia));

    // A layout that is not a JSON object is no view.
    expect((await putLayout(surveyId, "table", adam, { text: "[1]" })).status).toBe(204);
    await expectViewNotFound(await get(surveyId, "table", mia));
  });

  it("is not copied to a clone", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    expect((await putLayout(surveyId, "summary", adam, { text: TEXT })).status).toBe(204);
    const response = await call("POST", "/surveys/{surveyId}/clones", {
      path: `/surveys/${surveyId}/clones`,
      headers: adam,
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    onTestFinished(() => cleanUp(adam, id));
    await expectLayoutNotFound(await getLayout(id, "summary", adam));
  });

  it("refuses an unknown kind, an empty text, no CSRF token and no session", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await created(adam);
    expect((await getLayout(surveyId, "charts", adam)).status).toBe(400);
    for (const body of [{ text: "" }, {}, { text: 5 }]) {
      const response = await putLayout(surveyId, "table", adam, body);
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    await expectLayoutNotFound(await getLayout(surveyId, "table", adam));
    if (!sandbox) {
      const { cookie = "" } = adam;
      for (const response of [
        await putLayout(surveyId, "table", { cookie }, { text: "{}" }),
        await deleteLayout(surveyId, "table", { cookie }),
      ]) {
        expect(response.status).toBe(403);
        expect(await codeOf(response)).toBe("csrf-token-invalid");
      }
    }
    expect((await getLayout(surveyId, "table")).status).toBe(401);
    expect((await putLayout(surveyId, "table", undefined, { text: "{}" })).status).toBe(401);
    expect((await deleteLayout(surveyId, "table")).status).toBe(401);
  });
});
