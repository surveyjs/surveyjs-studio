import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openapiPath } from "@surveyjs-studio/contract";
import Fastify, { type FastifyInstance } from "fastify";
import { parse } from "yaml";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "./api.js";
import { buildApp, type BuildOptions } from "./app.js";
import { signIn } from "./auth/testing.js";
import { loadConfig } from "./config.js";
import { loadContract } from "./contract.js";
import { newFileId } from "./domain/file-id.js";
import { PROBLEM_CONTENT_TYPE, toProblem } from "./errors.js";
import { createProviders, type ProviderSet } from "./providers/index.js";
import { MEMBER_ID, ownerUser, PROJECT_A_ID, surveyFeedback } from "./providers/suite/expected.js";

const testEnv = { NODE_ENV: "test", IDENTITY_PROVIDER: "dev", MEMORY_SEED: "legacy-fixtures" };
let app: FastifyInstance | undefined;
/** The providers of the last started app. */
let providers: ProviderSet | undefined;

async function start(
  env: Record<string, string> = {},
  options?: BuildOptions,
): Promise<FastifyInstance> {
  const config = loadConfig({ ...testEnv, ...env });
  providers = await createProviders(config);
  app = await buildApp(config, providers, options);
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A signed-in app and the request headers of the owner's browser (cookies and CSRF token). */
async function startSignedIn(env: Record<string, string> = {}): Promise<{
  server: FastifyInstance;
  headers: Record<string, string>;
}> {
  const instance = await start(env);
  const { headers } = await signIn(instance, ownerUser.id);
  return { server: instance, headers };
}

describe("getConfig", () => {
  it("returns the defaults, with surveyjsLicenseKey null when unset", async () => {
    const res = await (await start()).inject("/api/v1/config");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toStrictEqual({
      edition: "self-hosted",
      shell: "surveyjs-site",
      authMethods: ["surveyjs"],
      surveyjsLicenseKey: null,
      limits: {
        maxAssetBytesPerSurvey: 52428800,
        maxFileBytes: 10485760,
        maxResponseBytes: 1048576,
        maxDocumentBytes: 30000000,
      },
      readOnly: false,
      links: {
        settings: "https://surveyjs.io/manage",
        helpDesk: "https://surveyjs.answerdesk.io/ticket/list?preset=mytickets",
        billing: "https://surveyjs.io/manage#billing",
      },
    });
  });

  it("returns the configured values", async () => {
    const res = await (
      await start({
        APP_EDITION: "hosted",
        IDENTITY_PROVIDER: "surveyjs-oidc",
        OIDC_ISSUER_URL: "https://auth.example.com",
        OIDC_CLIENT_ID: "client",
        OIDC_CLIENT_SECRET: "secret",
        APP_SHELL: "powered-by-surveyjs",
        AUTH_METHODS: "surveyjs",
        SURVEYJS_LICENSE_KEY: "key-123",
        LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "300",
        LIMIT_MAX_FILE_BYTES: "200",
        LIMIT_MAX_RESPONSE_BYTES: "100",
        LIMIT_MAX_DOCUMENT_BYTES: "400",
        SHELL_LINKS: JSON.stringify({
          billing: "https://billing.example.com/",
          status: "https://status.example.com/",
        }),
      })
    ).inject("/api/v1/config");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      edition: "hosted",
      shell: "powered-by-surveyjs",
      authMethods: ["surveyjs"],
      surveyjsLicenseKey: "key-123",
      limits: {
        maxAssetBytesPerSurvey: 300,
        maxFileBytes: 200,
        maxResponseBytes: 100,
        maxDocumentBytes: 400,
      },
      readOnly: false,
      // SHELL_LINKS replaces a built-in link and adds a new one; the others stay.
      links: {
        settings: "https://surveyjs.io/manage",
        helpDesk: "https://surveyjs.answerdesk.io/ticket/list?preset=mytickets",
        billing: "https://billing.example.com/",
        status: "https://status.example.com/",
      },
    });
  });
});

describe("request validation", () => {
  it("a JSON body that violates the schema answers 422 validation-failed with pointers", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/surveys",
      headers,
      payload: { name: 5 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "https://studio.surveyjs.io/problems/validation-failed",
      status: 422,
      code: "validation-failed",
      errors: [{ pointer: "/name" }],
    });
  });

  it("does not coerce body values to the schema type", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "PATCH",
      url: "/api/v1/surveys/s1",
      headers,
      payload: { archived: "true" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ errors: [{ pointer: "/archived" }] });
  });

  it("validates application/merge-patch+json bodies", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "PATCH",
      url: "/api/v1/surveys/s1",
      headers: { ...headers, "content-type": "application/merge-patch+json" },
      payload: JSON.stringify({ name: "" }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "validation-failed", errors: [{ pointer: "/name" }] });
  });

  it("a valid merge-patch body reaches the operation", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_A_ID}`,
      headers: { ...headers, "content-type": "application/merge-patch+json; charset=utf-8" },
      payload: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: PROJECT_A_ID, name: "Renamed" });
  });

  it("a missing required body answers 422 validation-failed", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "PUT",
      url: "/api/v1/surveys/s1/definition",
      headers,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "validation-failed", errors: [{ pointer: "" }] });
  });

  it("a body in a media type the operation does not declare answers 415", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/surveys",
      headers: { ...headers, "content-type": "text/plain" },
      payload: "hello",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: "unsupported-media-type" });
  });

  it("an invalid query parameter answers 400 bad-request", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({ url: "/api/v1/surveys?limit=0", headers });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "bad-request", errors: [{ pointer: "/limit" }] });
  });

  it("a query parameter of the wrong type answers 400 bad-request", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({ url: "/api/v1/surveys?archived=maybe", headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", errors: [{ pointer: "/archived" }] });
  });

  it("an invalid path parameter answers 400 bad-request", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({ url: `/api/v1/surveys/${"x".repeat(65)}`, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", errors: [{ pointer: "/surveyId" }] });
  });
});

describe("operations without a handler", () => {
  /** The API routes of the contract without any handler, on a bare Fastify. */
  async function startBare(): Promise<FastifyInstance> {
    const bare = Fastify();
    bare.setErrorHandler((error, _request, reply) => {
      const body = toProblem(error);
      return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
    });
    await bare.register(apiRoutes, {
      prefix: "/api/v1",
      contract: await loadContract(openapiPath),
      handlers: {},
      authentication: { sessionSecret: loadConfig(testEnv).sessionSecret },
    });
    app = bare;
    return bare;
  }

  it("answer 501 not-implemented naming the operationId", async () => {
    const res = await (await startBare()).inject("/api/v1/config");
    expect(res.statusCode).toBe(501);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toStrictEqual({
      type: "https://studio.surveyjs.io/problems/not-implemented",
      title: "Not implemented",
      status: 501,
      code: "not-implemented",
      detail: expect.stringContaining("getConfig") as string,
    });
  });

  it("still authenticate first", async () => {
    const res = await (await startBare()).inject("/api/v1/projects/p1/members");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("multipart uploads reach the operation instead of answering 415", async () => {
    const boundary = "----test";
    const res = await (
      await start()
    ).inject({
      method: "POST",
      url: "/api/v1/public/surveys/s1/files",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.txt"',
        "Content-Type: text/plain",
        "",
        "hello",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    });
    // The body reached the operation, which found no survey s1.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "survey-not-available" });
  });

  it("a JSON body to a multipart operation answers 415", async () => {
    const { server, headers } = await startSignedIn();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/surveys/s1/assets",
      headers,
      payload: { file: "x" },
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: "unsupported-media-type" });
  });

  it("unknown /api/v1 routes stay 404 not-found", async () => {
    const res = await (await start()).inject("/api/v1/nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not-found" });
  });
});

interface ContractOperation {
  operationId: string;
  method: string;
  url: string;
}

function contractOperations(): ContractOperation[] {
  type Param = { $ref?: string; in?: string; name?: string; schema?: { enum?: string[] } };
  type Operation = { operationId?: string; parameters?: Param[] };
  type Doc = {
    paths: Record<string, Record<string, unknown> & { parameters?: Param[] }>;
    components: { parameters: Record<string, Param> };
  };
  const doc = parse(readFileSync(openapiPath, "utf8")) as Doc;
  const deref = (p: Param): Param =>
    p.$ref === undefined
      ? p
      : (doc.components.parameters[p.$ref.replace("#/components/parameters/", "")] ?? {});
  // Ids of the owner's fixture records, so implemented reads find them (a 404 here means "not routed").
  const pathValues: Record<string, string> = {
    surveyId: surveyFeedback.id,
    projectId: PROJECT_A_ID,
    userId: MEMBER_ID,
    fileId: STORED_FILE.id,
  };
  const methods = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
  const operations: ContractOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of methods) {
      const op = item[method] as Operation | undefined;
      if (op?.operationId === undefined) continue;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(deref);
      const url = path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
        const param = params.find((p) => p.in === "path" && p.name === name);
        return param?.schema?.enum?.[0] ?? pathValues[name] ?? "abc";
      });
      operations.push({ operationId: op.operationId, method: method.toUpperCase(), url });
    }
  }
  return operations;
}

/** A file the coverage test stores before `downloadFile` (the fixtures hold none). */
const STORED_FILE = {
  id: newFileId(surveyFeedback.id),
  surveyId: surveyFeedback.id,
  kind: "asset",
  name: "a.png",
  contentType: "image/png",
  size: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** A synthetic webhook secret (base64 of 24 bytes). */
const COVERAGE_ENV = { ACCOUNT_WEBHOOK_SECRET: `whsec_${Buffer.alloc(24, 1).toString("base64")}` };

describe("contract coverage", () => {
  const operations = contractOperations();

  it("finds every operation of the contract", () => {
    expect(operations).toHaveLength(42);
  });

  it.each(operations.map((op) => [op.operationId, op] as const))(
    "%s is routed under /api/v1",
    async (_id, op) => {
      // With a webhook secret, so that the webhook is routed (without one it answers 404).
      const { server, headers } = await startSignedIn(COVERAGE_ENV);
      if (op.operationId === "downloadFile") {
        await providers?.files.putFile(STORED_FILE, Buffer.from([0]));
      }
      const res = await server.inject({
        method: op.method as "GET",
        url: `/api/v1${op.url}`,
        headers,
      });
      expect(res.statusCode).not.toBe(404);
      // The webhook is called without a signature.
      const accepted =
        op.operationId === "receiveAccountDeleted"
          ? [401]
          : [200, 201, 204, 302, 400, 409, 422, 501];
      expect(accepted).toContain(res.statusCode);
    },
  );
});

describe("/api/docs", () => {
  let dir: string;
  let docsFile: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "my-surveys-docs-"));
    docsFile = join(dir, "reference.html");
    await writeFile(docsFile, "<!doctype html><title>API</title>");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the API reference as text/html when enabled", async () => {
    const res = await (
      await start({ API_DOCS: "true" }, { apiDocsPath: docsFile })
    ).inject("/api/docs");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toBe("<!doctype html><title>API</title>");
  });

  it("answers 404 with a hint when the reference has not been built", async () => {
    const res = await (
      await start({ API_DOCS: "true" }, { apiDocsPath: join(dir, "missing.html") })
    ).inject("/api/docs");
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "not-found", detail: "Run pnpm build:docs" });
  });

  it("is a plain 404 when API_DOCS=false", async () => {
    const res = await (
      await start({ API_DOCS: "false" }, { apiDocsPath: docsFile })
    ).inject("/api/docs");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toStrictEqual({
      type: "https://studio.surveyjs.io/problems/not-found",
      title: "Not found",
      status: 404,
      code: "not-found",
    });
  });
});
