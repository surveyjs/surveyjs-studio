// The coverage test: every operation of the contract is answered by an area handler or listed in
// UNSUPPORTED_OPERATIONS (D7), never both. It runs in jsdom with the web setup: the setup file
// touches `window`, so a node test environment cannot be used, and the web's type check has
// no Node types for `node:fs` or the contract's main entry. The contract's `openapi.yaml` is read as
// text with Vite's `?raw` instead.
import openapiText from "../../../../contract/openapi.yaml?raw";
import type { HttpHandler } from "msw";
import { describe, expect, it } from "vitest";
import { areaHandlers } from "./index";
import { setupSandbox, SURVEYS, USERS } from "./testing";
import {
  SECURED_UNSUPPORTED_OPERATIONS,
  UNSUPPORTED_OPERATIONS,
  unsupportedHandlers,
} from "./unsupported";

interface Operation {
  id: string;
  method: string;
  path: string;
  /** `security: []`: no session needed. */
  public: boolean;
}

/** The operations of `openapi.yaml`: path, method, operationId and `security: []`, read line by line. */
function contractOperations(): Operation[] {
  const operations: Operation[] = [];
  const publicOperations = new Set<string>();
  let path = "";
  let method = "";
  let inPaths = false;
  for (const line of openapiText.split(/\r?\n/)) {
    if (/^paths:/.test(line)) inPaths = true;
    else if (/^\S/.test(line) && !line.startsWith("#")) inPaths = false;
    if (!inPaths) continue;
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) path = pathMatch[1]!;
    const methodMatch = /^ {4}(get|put|post|patch|delete):\s*$/.exec(line);
    if (methodMatch) method = methodMatch[1]!.toUpperCase();
    const idMatch = /^ {6}operationId:\s*(\w+)\s*$/.exec(line);
    if (idMatch) operations.push({ id: idMatch[1]!, method, path, public: false });
    if (/^ {6}security:\s*\[\]\s*$/.test(line)) publicOperations.add(`${method} ${path}`);
  }
  return operations.map((operation) => ({
    ...operation,
    public: publicOperations.has(`${operation.method} ${operation.path}`),
  }));
}

const mswPath = (path: string) => `*/api/v1${path.replace(/\{(\w+)\}/g, ":$1")}`;

const answers = (handlers: readonly HttpHandler[], { method, path }: Operation) =>
  handlers.some((h) => h.info.method === method && h.info.path === mswPath(path));

describe("the contract's operations", () => {
  const operations = contractOperations();
  const context = setupSandbox().ctx;
  const area = areaHandlers(context);
  const unsupported = unsupportedHandlers(context);

  it("are all found in openapi.yaml", () => {
    // Counted from the text, not a fixed number, so branches that add operations do not conflict here.
    const declared = openapiText.match(/^\s+operationId:/gm)?.length ?? 0;
    expect(declared).toBeGreaterThan(0);
    expect(operations).toHaveLength(declared);
  });

  it("are each answered by an area handler or listed as unsupported, never both", () => {
    for (const operation of operations) {
      const handled = answers(area, operation);
      const listed = UNSUPPORTED_OPERATIONS.includes(operation.id);
      expect(
        [handled, listed].filter(Boolean),
        `${operation.id} must be handled or unsupported, not both`,
      ).toHaveLength(1);
    }
  });

  it("list only operations of the contract, each with an unsupported handler", () => {
    const ids = operations.map((operation) => operation.id);
    expect(new Set(UNSUPPORTED_OPERATIONS).size).toBe(UNSUPPORTED_OPERATIONS.length);
    for (const id of UNSUPPORTED_OPERATIONS) expect(ids).toContain(id);
    for (const id of UNSUPPORTED_OPERATIONS) {
      const operation = operations.find((candidate) => candidate.id === id)!;
      expect(answers(unsupported, operation), id).toBe(true);
    }
    expect(unsupported).toHaveLength(UNSUPPORTED_OPERATIONS.length);
  });

  it("check the session first exactly for those the contract secures", () => {
    for (const operation of operations.filter((op) => UNSUPPORTED_OPERATIONS.includes(op.id))) {
      expect(SECURED_UNSUPPORTED_OPERATIONS.includes(operation.id), operation.id).toBe(
        !operation.public,
      );
    }
  });

  it("name the operations D7 lists", () => {
    expect([...UNSUPPORTED_OPERATIONS].sort()).toEqual(
      [
        "login",
        "loginCallback",
        "passwordLogin",
        "setPasswordWithLink",
        "changeOwnPassword",
        "listUsers",
        "createUser",
        "updateUser",
        "deleteUser",
        "createUserResetLink",
        "getSurveyHistoryEntry",
        "exportResults",
        "receiveAccountDeleted",
      ].sort(),
    );
  });
});

describe("unsupported operations and unknown paths", () => {
  it("answer 501 not-implemented as a Problem", async () => {
    const { call } = setupSandbox();
    const operations = contractOperations().filter((op) => UNSUPPORTED_OPERATIONS.includes(op.id));
    for (const operation of operations) {
      // A survey the owner can see: exportResults looks it up before its 501.
      const path = operation.path.replace("{surveyId}", SURVEYS.feedback).replace(/\{\w+\}/g, "x");
      const response = await call(path, { method: operation.method, user: USERS.owner });
      expect(response.status, operation.id).toBe(501);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(await response.json(), operation.id).toMatchObject({
        type: "https://studio.surveyjs.io/problems/not-implemented",
        status: 501,
        code: "not-implemented",
      });
    }
  });

  it("answer 401 before 501 without a session when the contract secures them", async () => {
    const { call } = setupSandbox();
    const operations = contractOperations().filter((op) => UNSUPPORTED_OPERATIONS.includes(op.id));
    for (const operation of operations) {
      const path = operation.path.replace("{surveyId}", SURVEYS.feedback).replace(/\{\w+\}/g, "x");
      const response = await call(path, { method: operation.method });
      expect(response.status, operation.id).toBe(operation.public ? 501 : 401);
    }
  });

  it("answer exportResults with 404 before 501 for an unknown or invisible survey", async () => {
    const { call } = setupSandbox();
    const exportOf = (id: string) => `/surveys/${id}/results/export`;
    for (const [id, user] of [
      ["99999999-0000-4000-8000-a00000000099", USERS.owner],
      [SURVEYS.feedback, USERS.outsider],
    ] as const) {
      const response = await call(exportOf(id), { user });
      expect(response.status, id).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not-found" });
    }
    const long = await call(exportOf("x".repeat(65)), { user: USERS.owner });
    expect(long.status).toBe(400);
    expect((await call(exportOf(SURVEYS.feedback), { user: USERS.owner })).status).toBe(501);
  });

  it("answer 501 for any other /api/v1 request", async () => {
    const { call } = setupSandbox();
    for (const [path, method] of [
      ["/anything", "GET"],
      ["/surveys/x/unknown/deeper", "POST"],
      ["/me/other", "DELETE"],
    ] as const) {
      const response = await call(path, { method });
      expect(response.status, `${method} ${path}`).toBe(501);
      expect(await response.json()).toMatchObject({ code: "not-implemented" });
    }
  });
});
