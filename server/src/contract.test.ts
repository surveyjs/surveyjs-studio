import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openapiPath } from "@surveyjs-studio/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadContract } from "./contract.js";

describe("loadContract", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "my-surveys-contract-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("compiles every schema of the contract in strict mode without warnings", async () => {
    const spies = (["log", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const contract = await loadContract(openapiPath);
      expect(contract.operations).toHaveLength(47);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("converts path templates to Fastify routes", async () => {
    const contract = await loadContract(openapiPath);
    const view = contract.operations.find((op) => op.operationId === "getResultsView");
    expect(view).toMatchObject({ method: "GET", url: "/surveys/:surveyId/views/:view" });
  });

  it("gives each operation its effective security: its own, else the document's", async () => {
    const contract = await loadContract(openapiPath);
    const security = (id: string) =>
      contract.operations.find((op) => op.operationId === id)?.security;
    expect(security("getConfig")).toEqual([]);
    expect(security("logout")).toEqual([["cookieAuth", "csrfToken"], []]);
    expect(security("createSurvey")).toEqual([["cookieAuth", "csrfToken"], ["bearerAuth"]]);
    expect(security("getCurrentUser")).toEqual([["cookieAuth"], ["bearerAuth"]]);
  });

  it("reads a missing top-level security as public", async () => {
    const source = await readFile(openapiPath, "utf8");
    const withoutTopLevel = source.replace(/^security:\r?\n( {2}- .*\r?\n)+/m, "");
    expect(withoutTopLevel).not.toBe(source);
    const file = join(dir, "no-security.yaml");
    await writeFile(file, withoutTopLevel);
    const contract = await loadContract(file);
    const me = contract.operations.find((op) => op.operationId === "getCurrentUser");
    expect(me?.security).toEqual([]);
  });

  it("rejects a contract whose schemas use an unknown keyword", async () => {
    const source = await readFile(openapiPath, "utf8");
    const broken = source.replace(
      /( {4}ProjectName:\r?\n {6}type: string\r?\n)/,
      "$1      bogusKeyword: true\n",
    );
    expect(broken).not.toBe(source);
    const file = join(dir, "broken.yaml");
    await writeFile(file, broken);
    await expect(loadContract(file)).rejects.toThrow(/bogusKeyword/);
  });
});
