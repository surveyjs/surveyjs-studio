import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { openapiPath } from "./index.js";

interface Operation {
  operationId?: string;
  security?: Record<string, unknown>[];
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
  security?: Record<string, unknown>[];
  paths: Record<string, Record<string, Operation>>;
}

const METHODS = ["get", "put", "post", "delete", "patch"];

function operations(doc: OpenApiDocument): Operation[] {
  return Object.values(doc.paths).flatMap((item) =>
    Object.entries(item)
      .filter(([method]) => METHODS.includes(method))
      .map(([, operation]) => operation),
  );
}

describe("contract package", () => {
  it("openapiPath points to an OpenAPI 3.1.0 document containing getConfig", () => {
    expect(existsSync(openapiPath)).toBe(true);
    const doc = parse(readFileSync(openapiPath, "utf8")) as OpenApiDocument;
    expect(doc.openapi).toBe("3.1.0");
    const operationIds = Object.values(doc.paths).flatMap((item) =>
      Object.values(item).map((operation) => operation.operationId),
    );
    expect(operationIds).toContain("getConfig");
  });

  // The server answers these before any handler runs, so every operation they apply to documents them.
  it("documents the answers of the authentication and sign-in rules", () => {
    const doc = parse(readFileSync(openapiPath, "utf8")) as OpenApiDocument;
    const missing: string[] = [];
    for (const op of operations(doc)) {
      const security = op.security ?? doc.security ?? [];
      const statuses = Object.keys(op.responses ?? {});
      const expectStatus = (status: string) => {
        if (!statuses.includes(status)) missing.push(`${op.operationId ?? "?"} ${status}`);
      };
      if (security.length > 0) expectStatus("401");
      if (security.some((requirement) => "csrfToken" in requirement)) expectStatus("403");
      if (["login", "loginCallback", "passwordLogin"].includes(op.operationId ?? "")) {
        expectStatus("429");
      }
    }
    expect(missing).toEqual([]);
  });
});
