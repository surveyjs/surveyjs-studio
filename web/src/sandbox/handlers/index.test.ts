// The coverage test: every operation of the contract is answered by an area handler or listed in
// UNSUPPORTED_OPERATIONS (D7), never both. It runs in jsdom with the web setup: the setup file
// touches `window`, so a node test environment cannot be used, and the web's type check has
// no Node types for `node:fs` or the contract's main entry. The contract's `openapi.yaml` is read as
// text with Vite's `?raw` instead.
import openapiText from "../../../../contract/openapi.yaml?raw";
import type { HttpHandler } from "msw";
import { describe, expect, it } from "vitest";
import { areaHandlers } from "./index";
import { setupSandbox, USERS } from "./testing";
import { UNSUPPORTED_OPERATIONS, unsupportedHandlers } from "./unsupported";

interface Operation {
  id: string;
  method: string;
  path: string;
}

/** The operations of `openapi.yaml`: path, method and operationId, read line by line. */
function contractOperations(): Operation[] {
  const operations: Operation[] = [];
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
    if (idMatch) operations.push({ id: idMatch[1]!, method, path });
  }
  return operations;
}

const mswPath = (path: string) => `*/api/v1${path.replace(/\{(\w+)\}/g, ":$1")}`;

const answers = (handlers: readonly HttpHandler[], { method, path }: Operation) =>
  handlers.some((h) => h.info.method === method && h.info.path === mswPath(path));

/**
 * Operations whose handlers come with Task 5 (projects and members). Each task removes its operations from this list: a handled operation
 * still listed fails the test.
 */
const LATER_TASKS: readonly string[] = [
  "listProjects",
  "createProject",
  "getProject",
  "updateProject",
  "deleteProject",
  "listMembers",
  "addMember",
  "updateMember",
  "removeMember",
  "removeInvitation",
];

describe("the contract's operations", () => {
  const operations = contractOperations();
  const context = setupSandbox().ctx;
  const area = areaHandlers(context);
  const unsupported = unsupportedHandlers();

  it("are all found in openapi.yaml", () => {
    expect(operations).toHaveLength(48);
  });

  it("are each answered by an area handler or listed as unsupported, never both", () => {
    for (const operation of operations) {
      const handled = answers(area, operation);
      const listed = UNSUPPORTED_OPERATIONS.includes(operation.id);
      const later = LATER_TASKS.includes(operation.id);
      expect(
        [handled, listed, later].filter(Boolean),
        `${operation.id} must be handled, unsupported or pending exactly once`,
      ).toHaveLength(1);
    }
  });

  it("list only operations of the contract, each with an unsupported handler", () => {
    const ids = operations.map((operation) => operation.id);
    expect(new Set(UNSUPPORTED_OPERATIONS).size).toBe(UNSUPPORTED_OPERATIONS.length);
    for (const id of [...UNSUPPORTED_OPERATIONS, ...LATER_TASKS]) expect(ids).toContain(id);
    for (const id of UNSUPPORTED_OPERATIONS) {
      const operation = operations.find((candidate) => candidate.id === id)!;
      expect(answers(unsupported, operation), id).toBe(true);
    }
    expect(unsupported).toHaveLength(UNSUPPORTED_OPERATIONS.length);
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
      const path = operation.path.replace(/\{\w+\}/g, "x");
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
