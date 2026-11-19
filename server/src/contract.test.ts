import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openapiPath } from "@surveyjs-studio/contract";
import { parse } from "yaml";
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
      // Counted from the YAML text, not a fixed number, so branches that add operations do not conflict here.
      const declared =
        (await readFile(openapiPath, "utf8")).match(/^\s+operationId:/gm)?.length ?? 0;
      expect(declared).toBeGreaterThan(0);
      expect(contract.operations).toHaveLength(declared);
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

  it("keeps bearer credentials away from account, project and member management", async () => {
    const contract = await loadContract(openapiPath);
    const security = (id: string) =>
      contract.operations.find((op) => op.operationId === id)?.security;
    const sessionOnly = [
      "createProject",
      "deleteProject",
      "addMember",
      "updateMember",
      "removeMember",
      "removeInvitation",
      "listApiTokens",
      "createApiToken",
      "revokeApiToken",
      "revokeLegacyAccessKey",
    ];
    for (const id of sessionOnly) {
      const alternatives = security(id);
      expect(alternatives, id).toBeDefined();
      expect(JSON.stringify(alternatives), id).not.toContain("bearerAuth");
    }
    expect(security("createApiToken")).toEqual([["cookieAuth", "csrfToken"]]);
    expect(security("revokeLegacyAccessKey")).toEqual([["cookieAuth", "csrfToken"]]);
    expect(security("listApiTokens")).toEqual([["cookieAuth"]]);
    expect(security("replaceCurrentCredential")).toEqual([["bearerAuth"]]);
    const source = parse(await readFile(openapiPath, "utf8")) as {
      components: { securitySchemes: { bearerAuth: Record<string, unknown> } };
    };
    expect(source.components.securitySchemes.bearerAuth).not.toHaveProperty("x-phase");
  });

  it("has no P1 marker on the partial response fields", async () => {
    const source = parse(await readFile(openapiPath, "utf8")) as {
      components: {
        schemas: {
          ResponseSubmission: { properties: { partial: object; lastPageIndex: object } };
          SurveyResponse: { properties: { partial: object } };
        };
      };
    };
    const { ResponseSubmission, SurveyResponse } = source.components.schemas;
    expect(ResponseSubmission.properties.partial).not.toHaveProperty("x-phase");
    expect(ResponseSubmission.properties.lastPageIndex).not.toHaveProperty("x-phase");
    expect(SurveyResponse.properties.partial).not.toHaveProperty("x-phase");
  });

  it("declares the bridge's public operations as unauthenticated and rate limited", async () => {
    const contract = await loadContract(openapiPath);
    const appSource = await readFile(new URL("./app.ts", import.meta.url), "utf8");
    const listed = /const PUBLIC_OPERATIONS[^=]*=\s*\[([^\]]*)\]/.exec(appSource)?.[1] ?? "";
    const bridgeOperations = [
      "getPublicDefinition",
      "getRespondentState",
      "getRespondentStateByResultId",
      "submitResponseByPostId",
      "uploadResponseFileByPostId",
      "getQuestionSummary",
      "getLegacyFile",
    ];
    for (const id of bridgeOperations) {
      const op = contract.operations.find((o) => o.operationId === id);
      expect(op, id).toBeDefined();
      expect(op?.security, id).toEqual([]);
      expect(listed, id).toContain(`"${id}"`);
    }
  });

  it("lets getPublicResults filter by from and till", async () => {
    const source = parse(await readFile(openapiPath, "utf8")) as {
      paths: Record<string, { get?: { operationId: string; parameters?: { name: string }[] } }>;
    };
    const get = source.paths["/public/surveys/{surveyId}/results"]?.get;
    expect(get?.operationId).toBe("getPublicResults");
    const names = get?.parameters?.map((p) => p.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["from", "till"]));
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
