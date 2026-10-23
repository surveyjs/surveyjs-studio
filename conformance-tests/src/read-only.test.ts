/**
 * `READ_ONLY=true`: every write the contract documents with the `503 ReadOnly` response answers
 * `503 read-only`, while reads, sign-in and sign-out keep working.
 *
 * Runs only against a server whose `/config` reports `readOnly: true` (`pnpm
 * test:conformance:read-only`); the other runs skip it. Each call is made so that it could change
 * nothing even on a server that did not refuse it: unknown ids, empty bodies, a webhook event for a
 * user nobody has.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openapiPath } from "@my-surveys/contract";
import { parse } from "yaml";
import { describe, expect, inject, it } from "vitest";
import { baseUrl, call, sessionHeaders, signedIn, upload } from "./harness.js";
import type { SignInResult } from "./sign-in.js";
import { signWebhook, webhookKey } from "./webhook.js";

const READ_ONLY_RESPONSE = "#/components/responses/ReadOnly";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

interface Operation {
  readonly operationId: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly multipart: boolean;
}

type ContractOp = {
  operationId?: string;
  requestBody?: { content?: Record<string, unknown> };
  responses?: Record<string, { $ref?: string } | undefined>;
};

/** The operations that document `503 ReadOnly`. */
function refusedOperations(): Operation[] {
  const doc = parse(readFileSync(openapiPath, "utf8")) as {
    paths: Record<string, Record<string, ContractOp>>;
  };
  const operations: Operation[] = [];
  for (const [pathTemplate, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op.responses?.["503"]?.$ref !== READ_ONLY_RESPONSE || op.operationId === undefined) {
        continue;
      }
      operations.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        pathTemplate,
        multipart: Object.keys(op.requestBody?.content ?? {}).includes("multipart/form-data"),
      });
    }
  }
  return operations;
}

const config = (await (await fetch(`${baseUrl}/api/v1/config`)).json()) as { readOnly?: unknown };
const operations = refusedOperations();

describe.runIf(config.readOnly === true)("READ_ONLY=true", () => {
  it("documents the refusal on the writes", () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  let session: SignInResult | undefined;

  it.for(operations.map((op) => [op.operationId, op] as const))(
    "%s answers 503 read-only",
    async ([, op], ctx) => {
      session ??= await signedIn(ctx);
      const headers = sessionHeaders(session);
      const path = op.pathTemplate.replace(/\{[^}]+\}/g, UNKNOWN_ID);
      let response: Response;
      if (op.multipart) {
        const form = new FormData();
        form.append("file", new Blob(["read-only"], { type: "text/plain" }), "read-only.txt");
        response = await upload(op.pathTemplate, { path, headers, form });
      } else if (op.operationId === "receiveAccountDeleted") {
        const secret = inject("webhookSecret");
        const body = JSON.stringify({ type: "account.deleted", data: { userId: randomUUID() } });
        response = await call(op.method, op.pathTemplate, {
          path,
          rawBody: body,
          headers: secret === null ? {} : signWebhook(webhookKey(secret), body),
        });
      } else {
        response = await call(op.method, op.pathTemplate, { path, headers, body: {} });
      }
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: 503,
        code: "read-only",
        title: "My Surveys is read-only at the moment. Changes cannot be saved.",
      });
    },
  );

  it("keeps reads and sign-out working", async (ctx) => {
    const headers = sessionHeaders(await signedIn(ctx));
    expect((await call("GET", "/surveys", { headers })).status).toBe(200);
    expect((await call("POST", "/auth/logout", { headers })).status).toBe(200);
  });
});
