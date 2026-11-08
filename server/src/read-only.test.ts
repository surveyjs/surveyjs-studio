import { readFileSync } from "node:fs";
import { openapiPath } from "@surveyjs-studio/contract";
import type { FastifyInstance } from "fastify";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webhookKey } from "./accounts/webhook-secret.js";
import { signWebhook } from "./accounts/webhook.js";
import { buildApp } from "./app.js";
import { signIn } from "./auth/testing.js";
import { loadConfig } from "./config.js";
import { loadContract, type Contract } from "./contract.js";
import { createProviders, type ProviderSet } from "./providers/index.js";
import { ownerUser, surveyFeedback } from "./providers/suite/expected.js";
import { READ_ONLY_ALLOWED, refusedWhenReadOnly } from "./read-only.js";

/**
 * Every operation `READ_ONLY=true` refuses. A new write operation fails this test until someone
 * decides whether it belongs here or on the allow-list.
 */
const REFUSED = [
  "changeOwnPassword",
  "setPasswordWithLink",
  "createUser",
  "updateUser",
  "deleteUser",
  "createUserResetLink",
  "createProject",
  "updateProject",
  "deleteProject",
  "addMember",
  "updateMember",
  "removeMember",
  "removeInvitation",
  "createSurvey",
  "updateSurvey",
  "deleteSurvey",
  "cloneSurvey",
  "saveSurveyDefinition",
  "saveSurveyTheme",
  "uploadSurveyAsset",
  "deleteResults",
  "saveResultsView",
  "resetResultsView",
  "submitResponse",
  "uploadResponseFile",
  "receiveAccountDeleted",
];

const READ_ONLY_PROBLEM = {
  type: "https://studio.surveyjs.io/problems/read-only",
  title: "My Surveys is read-only at the moment. Changes cannot be saved.",
  status: 503,
  code: "read-only",
};

const READ_ONLY_RESPONSE = "#/components/responses/ReadOnly";

type Responses = Record<string, { $ref?: string } | undefined>;
type Doc = {
  paths: Record<string, Record<string, { operationId?: string; responses?: Responses }>>;
};

/** The `responses` of each operation of the contract, by `operationId`. */
function contractResponses(): Map<string, Responses> {
  const doc = parse(readFileSync(openapiPath, "utf8")) as Doc;
  const byId = new Map<string, Responses>();
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      if (op?.operationId !== undefined) byId.set(op.operationId, op.responses ?? {});
    }
  }
  return byId;
}

describe("refusedWhenReadOnly", () => {
  let contract: Contract;

  beforeAll(async () => {
    contract = await loadContract(openapiPath);
  });

  it("refuses exactly the write operations of the contract", () => {
    const refused = contract.operations.filter(refusedWhenReadOnly).map((op) => op.operationId);
    expect(refused.toSorted()).toEqual(REFUSED.toSorted());
  });

  it("refuses every operation that is not GET, unless it is allowed", () => {
    expect(refusedWhenReadOnly({ method: "GET", operationId: "anyRead" })).toBe(false);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(refusedWhenReadOnly({ method, operationId: "aNewWrite" })).toBe(true);
    }
    expect(refusedWhenReadOnly({ method: "POST", operationId: "logout" })).toBe(false);
    expect(refusedWhenReadOnly({ method: "POST", operationId: "passwordLogin" })).toBe(false);
  });

  it("allows only sign-in and sign-out, both writes of the contract", () => {
    expect(READ_ONLY_ALLOWED).toEqual(["logout", "passwordLogin"]);
    for (const id of READ_ONLY_ALLOWED) {
      const op = contract.operations.find((o) => o.operationId === id);
      expect(op?.method).toBe("POST");
    }
  });

  it("documents the 503 ReadOnly response on each refused operation, and on no other", () => {
    for (const [id, responses] of contractResponses()) {
      const documented = responses["503"]?.$ref === READ_ONLY_RESPONSE;
      expect({ id, documented }).toEqual({ id, documented: REFUSED.includes(id) });
    }
  });
});

// The account-deleted webhook's secret and clock (synthetic values).
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const NOW_MS = Date.parse("2026-10-19T10:00:00.000Z");

describe("READ_ONLY=true", () => {
  let app: FastifyInstance;
  let providers: ProviderSet;
  let headers: Record<string, string>;
  const lines: string[] = [];

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
      ACCOUNT_WEBHOOK_SECRET: SECRET,
      READ_ONLY: "true",
    });
    providers = await createProviders(config);
    app = await buildApp(config, providers, {
      now: () => NOW_MS,
      logStream: { write: (line) => lines.push(line) },
    });
    headers = { ...(await signIn(app, ownerUser.id)).headers };
  });

  afterAll(async () => {
    await app.close();
  });

  function expectReadOnly(res: {
    statusCode: number;
    headers: Record<string, unknown>;
    json(): unknown;
  }) {
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toStrictEqual(READ_ONLY_PROBLEM);
  }

  it("refuses createSurvey before validation: an invalid body is 503, not 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/surveys",
      headers,
      payload: { name: 42, unknown: true },
    });
    expectReadOnly(res);
  });

  it("refuses before authentication: a call without a session is 503 too", async () => {
    expectReadOnly(await app.inject({ method: "POST", url: "/api/v1/surveys", payload: {} }));
  });

  it("refuses a multipart upload (uploadSurveyAsset)", async () => {
    const boundary = "----read-only";
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/surveys/${surveyFeedback.id}/assets`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.png"',
        "Content-Type: image/png",
        "",
        "png",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    });
    expectReadOnly(res);
    expect(await providers.files.usage(surveyFeedback.id, "asset")).toBe(0);
  });

  it("refuses a correctly signed account-deleted webhook and erases nothing", async () => {
    const personal = { kind: "personal", userId: ownerUser.id } as const;
    const surveysBefore = await providers.surveys.listSurveys(personal);
    const projectsBefore = await providers.projects.listUserProjects(ownerUser.id);
    expect(surveysBefore.length).toBeGreaterThan(0);
    const body = JSON.stringify({ type: "account.deleted", data: { userId: ownerUser.id } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/account-deleted",
      headers: {
        "content-type": "application/json",
        ...signWebhook(webhookKey(SECRET), "msg_read-only", NOW_MS / 1000, body),
      },
      payload: body,
    });
    expectReadOnly(res);
    expect(await providers.surveys.listSurveys(personal)).toEqual(surveysBefore);
    expect(await providers.projects.listUserProjects(ownerUser.id)).toEqual(projectsBefore);
  });

  it("refuses every refused operation of both route scopes", async () => {
    const contract = await loadContract(openapiPath);
    for (const op of contract.operations.filter(refusedWhenReadOnly)) {
      const url = `/api/v1${op.url.replace(/:[A-Za-z]+/g, "x")}`;
      const res = await app.inject({ method: op.method, url, headers, payload: {} });
      expect({ id: op.operationId, status: res.statusCode }).toEqual({
        id: op.operationId,
        status: 503,
      });
      expect(res.json()).toStrictEqual(READ_ONLY_PROBLEM);
    }
  });

  it("does not log a refusal as a server error", () => {
    expect(lines.filter((line) => line.includes('"level":50'))).toEqual([]);
  });

  it("keeps reads working", async () => {
    const res = await app.inject({ url: "/api/v1/surveys", headers });
    expect(res.statusCode).toBe(200);
  });

  it("reports readOnly in /config", async () => {
    const res = await app.inject("/api/v1/config");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ readOnly: true });
  });

  // Last: it ends the session the other tests use.
  it("keeps sign-out working", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers });
    expect(res.statusCode).toBe(200);
  });
});
