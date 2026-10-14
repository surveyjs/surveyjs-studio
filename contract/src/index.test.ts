import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { openapiPath } from "./index.js";

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, { operationId?: string }>>;
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
});
