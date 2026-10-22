/**
 * `receiveAccountDeleted`: the signed webhook surveyjs.io calls when a user deletes their account.
 *
 * Data rules: this file erases only Erin Erasable, and creates her data first (she has none in the
 * fixtures). Every erasure case lives in this one file, so no other file erases her while it runs.
 * Adam Admin is added to Erin's project, is promoted when she is erased, and receives the project's
 * surveys when he deletes it at the end; he then deletes them. The refusal cases name fresh random
 * ids, so a refusal that wrongly succeeded would erase nobody.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, inject, it, onTestFinished } from "vitest";
import { as, call, cleanUp, codeOf } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";
import { randomWebhookKey, signWebhook, webhookKey } from "./webhook.js";

const { admin, erasable } = fixtureUsers;
const secret = inject("webhookSecret");
const PATH = "/webhooks/account-deleted";
const MERGE_PATCH = "application/merge-patch+json";

type Headers = Record<string, string>;

const event = (type: string, data: unknown): string => JSON.stringify({ type, data });

/** Posts `body` as is (JSON media type) with the given headers. */
function deliver(body: string, headers: Headers = {}): Promise<Response> {
  return call("POST", PATH, { rawBody: body, headers });
}

/** Posts `body` signed with the server's secret (or `key`), stamped now (or `timestamp`). */
function deliverSigned(
  body: string,
  options: { key?: Buffer; timestamp?: number } = {},
): Promise<Response> {
  const key = options.key ?? webhookKey(secret!);
  return deliver(body, signWebhook(key, body, { timestamp: options.timestamp }));
}

async function created<T>(response: Response): Promise<T> {
  expect(response.status).toBe(201);
  return (await response.json()) as T;
}

function createSurvey(headers: Headers, body: object): Promise<Response> {
  return call("POST", "/surveys", { headers, body: { name: "Conformance erasure", ...body } });
}

function patchSurvey(headers: Headers, id: string, body: unknown): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": MERGE_PATCH, ...headers },
    body,
  });
}

function getSurvey(headers: Headers, id: string): Promise<Response> {
  return call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
}

function getProject(headers: Headers, id: string): Promise<Response> {
  return call("GET", "/projects/{projectId}", { path: `/projects/${id}`, headers });
}

function deleteProject(headers: Headers, id: string): Promise<Response> {
  return call("DELETE", "/projects/{projectId}", { path: `/projects/${id}`, headers });
}

async function itemsOf(headers: Headers, pathTemplate: string, path: string): Promise<unknown[]> {
  const response = await call("GET", pathTemplate, { path, headers });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: unknown[] }).items;
}

describe.skipIf(secret === null)("receiveAccountDeleted", () => {
  describe("refusals", () => {
    const body = () => event("account.deleted", { userId: randomUUID() });

    it("answers 401 invalid-signature without a signature", async () => {
      const response = await deliver(body());
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("invalid-signature");
    });

    it("answers 401 invalid-signature for a signature made with another secret", async () => {
      const response = await deliverSigned(body(), { key: randomWebhookKey() });
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("invalid-signature");
    });

    it.each([
      ["ten minutes old", -600],
      ["ten minutes ahead", 600],
    ])("answers 401 invalid-signature for a timestamp %s", async (_name, offset) => {
      const timestamp = Math.floor(Date.now() / 1000) + offset;
      const response = await deliverSigned(body(), { timestamp });
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("invalid-signature");
    });

    it("checks the signature before the body: a wrong one with an invalid body is 401", async () => {
      const response = await deliverSigned("{", { key: randomWebhookKey() });
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("invalid-signature");
    });

    it("answers 400 for a signed body that is not JSON", async () => {
      const response = await deliverSigned("{");
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    });

    it("answers 400 for a signed account.deleted event without a user id", async () => {
      const response = await deliverSigned(event("account.deleted", {}));
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    });
  });

  it("erases the account's data, passes its project on, and a repeat is harmless", async (ctx) => {
    const erin = await as(ctx, erasable);
    const adam = await as(ctx, admin);

    // Erin's data: two personal surveys (one archived), a project shared with Adam and one alone.
    const s1 = await created<{ id: string }>(await createSurvey(erin, {}));
    const s2 = await created<{ id: string }>(await createSurvey(erin, {}));
    expect((await patchSurvey(erin, s2.id, { archived: true })).status).toBe(200);
    const shared = await created<{ id: string }>(
      await call("POST", "/projects", {
        headers: erin,
        body: { name: `Conformance erasure ${randomUUID().slice(0, 8)}` },
      }),
    );
    let sharedSurveyId: string | null = null;
    onTestFinished(async () => {
      // Adam (promoted by the erasure) deletes the project and receives its survey; Erin's own
      // session deletes it when the erasure never happened.
      const statuses: number[] = [];
      let deletedProject = false;
      for (const headers of [adam, erin]) {
        const status = (await deleteProject(headers, shared.id)).status;
        if (status === 204) {
          deletedProject = true;
          break;
        }
        statuses.push(status);
      }
      expect(
        deletedProject,
        `project ${shared.id} was not cleaned up (answers ${statuses.join(", ")})`,
      ).toBe(true);
      if (sharedSurveyId === null) return;
      await cleanUp(adam, sharedSurveyId);
    });
    await created(
      await call("POST", "/projects/{projectId}/members", {
        path: `/projects/${shared.id}/members`,
        headers: erin,
        body: { email: admin.email, role: "user" },
      }),
    );
    sharedSurveyId = (
      await created<{ id: string }>(await createSurvey(erin, { projectId: shared.id }))
    ).id;
    const alone = await created<{ id: string }>(
      await call("POST", "/projects", {
        headers: erin,
        body: { name: `Conformance erasure ${randomUUID().slice(0, 8)}` },
      }),
    );
    const aloneSurvey = await created<{ id: string }>(
      await createSurvey(erin, { projectId: alone.id }),
    );

    // An event of another type changes nothing.
    const other = await deliverSigned(event("account.created", { userId: erasable.id }));
    expect(other.status).toBe(204);
    expect((await getSurvey(erin, s1.id)).status).toBe(200);

    const deletedEvent = event("account.deleted", { userId: erasable.id });
    const headers = signWebhook(webhookKey(secret!), deletedEvent);
    const erased = await deliver(deletedEvent, headers);
    expect(erased.status).toBe(204);

    // Erin's view: nothing left.
    for (const id of [s1.id, s2.id, aloneSurvey.id]) {
      expect((await getSurvey(erin, id)).status).toBe(404);
    }
    expect((await getProject(erin, shared.id)).status).toBe(404);
    expect((await getProject(erin, alone.id)).status).toBe(404);
    expect(await itemsOf(erin, "/projects", "/projects?limit=200")).toEqual([]);
    for (const archived of [false, true]) {
      const path = `/surveys?project=personal&archived=${archived}&limit=200`;
      expect(await itemsOf(erin, "/surveys", path)).toEqual([]);
    }

    // Adam's view: the shared project is his, as admin, with its survey.
    const project = await getProject(adam, shared.id);
    expect(project.status).toBe(200);
    expect(await project.json()).toMatchObject({ id: shared.id, role: "admin" });
    const members = await itemsOf(
      adam,
      "/projects/{projectId}/members",
      `/projects/${shared.id}/members`,
    );
    expect(members).toEqual([expect.objectContaining({ userId: admin.id, role: "admin" })]);
    expect((await getSurvey(adam, sharedSurveyId)).status).toBe(200);

    // The same signed message again (a retry): nothing left to erase.
    expect((await deliver(deletedEvent, headers)).status).toBe(204);
  });
});
