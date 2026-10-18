import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { openapiPath } from "@my-surveys/contract";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { apiRoutes, type OperationId, type RateLimit } from "./api.js";
import type { IdentityProvider } from "./auth/identity.js";
import { createIdentityProvider } from "./auth/providers/index.js";
import type { Clock } from "./auth/session.js";
import { createSessionHandlers } from "./auth/session-handlers.js";
import type { AppConfig } from "./config.js";
import { loadContract } from "./contract.js";
import { defaultApiDocsPath, registerApiDocs } from "./docs.js";
import { AppError, PROBLEM_CONTENT_TYPE, problem, toProblem, type Problem } from "./errors.js";
import { createHandlers } from "./handlers.js";
import { serializeRequest } from "./logging.js";
import { createProjectHandlers } from "./projects/handlers.js";
import type { ProviderSet } from "./providers/index.js";
import { createContentHandlers } from "./content/handlers.js";
import { createFileHandlers } from "./files/handlers.js";
import { createResultHandlers } from "./results/handlers.js";
import { createSurveyHandlers } from "./surveys/handlers.js";
import { createViewHandlers } from "./views/handlers.js";

export interface BuildOptions {
  /** Where the built API reference is read from (default: the contract package's dist). */
  readonly apiDocsPath?: string;
  /** Replaces the configured identity provider (tests). */
  readonly identity?: IdentityProvider;
  /** Clock for session and sign-in expiry and for creation times (tests). */
  readonly now?: Clock;
  /** Receives the JSON log lines, even when `NODE_ENV=test` (tests). */
  readonly logStream?: { write(line: string): void };
}

/** The respondent's operations, limited by `PUBLIC_RATE_LIMIT` per client IP and minute. */
const PUBLIC_OPERATIONS: readonly OperationId[] = [
  "getPublishedSurvey",
  "submitResponse",
  "uploadResponseFile",
];
/** Limited by `SIGN_IN_RATE_LIMIT` per client IP and minute. */
const SIGN_IN_OPERATIONS: readonly OperationId[] = ["login", "loginCallback", "passwordLogin"];

function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

export async function buildApp(
  config: AppConfig,
  providers: ProviderSet,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const contract = await loadContract(openapiPath);
  const app = Fastify({
    // The request serializer keeps the sign-in callback's `code` and `state` out of the logs.
    logger:
      config.nodeEnv === "test" && !options.logStream
        ? false
        : {
            level: config.logLevel,
            serializers: { req: serializeRequest },
            ...(options.logStream && { stream: options.logStream }),
          },
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && incoming !== "" && incoming.length <= 128
        ? incoming
        : randomUUID();
    },
    frameworkErrors: (error, request, reply) => {
      const body = toProblem(error);
      if (body.status >= 500) request.log.error({ err: error }, "framework error");
      return sendProblem(reply, body);
    },
    bodyLimit: config.limits.maxResponseBytes,
    // Empty trusts nobody: `request.ip` is then the socket's peer, whatever X-Forwarded-For says.
    ...(config.trustProxy.length > 0 && { trustProxy: [...config.trustProxy] }),
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    done(null, payload);
  });

  app.setErrorHandler((error, request, reply) => {
    const body = toProblem(error);
    // A 501 for a not-yet-implemented operation is an expected answer, not a server fault.
    if (body.status >= 500 && body.code !== "not-implemented") {
      request.log.error({ err: error }, "unhandled error");
    }
    return sendProblem(reply, body);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problem({ code: "not-found", status: 404, title: "Not found" })),
  );

  app.get("/healthz", () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    const ready = await providers.ready().catch(() => false);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "unavailable" });
  });

  // Only routes with a `rateLimit` config are limited (sign-in and the public operations); each
  // route has its own counter. This builder is the fallback; the routes set their own text.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new AppError({
        code: "rate-limited",
        status: 429,
        title: "Too many requests",
        detail: `Too many requests. Try again in ${context.after}.`,
      }),
  });

  const identity = options.identity ?? (await createIdentityProvider(config));
  if (identity.routes) await app.register(identity.routes);

  const window = 60_000;
  const signInLimit: RateLimit = {
    max: config.signInRateLimitPerMinute,
    timeWindow: window,
    detail: (after) => `Too many sign-in attempts. Try again in ${after}.`,
  };
  const publicLimit: RateLimit = {
    max: config.publicRateLimitPerMinute,
    timeWindow: window,
    detail: (after) => `Too many requests. Try again in ${after}.`,
  };
  const fileLimit: RateLimit = { ...publicLimit, max: config.publicFileRateLimitPerMinute };
  await app.register(apiRoutes, {
    prefix: "/api/v1",
    contract,
    handlers: {
      ...createHandlers(config),
      ...createSessionHandlers({
        config,
        identity,
        directory: providers.directory,
        notices: providers.notices,
        ...(options.now && { now: options.now }),
      }),
      ...createProjectHandlers({ directory: providers.directory }),
      ...createContentHandlers({
        surveys: providers.surveys,
        directory: providers.directory,
        ...(options.now && { now: options.now }),
      }),
      ...createSurveyHandlers({
        surveys: providers.surveys,
        directory: providers.directory,
        files: providers.files,
        ...(options.now && { now: options.now }),
      }),
      ...createResultHandlers({
        surveys: providers.surveys,
        directory: providers.directory,
        results: providers.results,
        ...(options.now && { now: options.now }),
      }),
      ...createViewHandlers({
        surveys: providers.surveys,
        directory: providers.directory,
        views: providers.views,
      }),
      ...createFileHandlers({
        surveys: providers.surveys,
        directory: providers.directory,
        files: providers.files,
        publicBaseUrl: config.publicBaseUrl,
        maxAssetBytesPerSurvey: config.limits.maxAssetBytesPerSurvey,
        maxFileBytes: config.limits.maxFileBytes,
        ...(options.now && { now: options.now }),
      }),
    },
    authentication: {
      sessionSecret: config.sessionSecret,
      ...(options.now && { now: options.now }),
    },
    rateLimits: {
      ...Object.fromEntries(SIGN_IN_OPERATIONS.map((id) => [id, signInLimit])),
      ...Object.fromEntries(PUBLIC_OPERATIONS.map((id) => [id, publicLimit])),
      downloadFile: fileLimit,
    },
    // Survey documents may carry inline images: they get their own, larger limit.
    bodyLimits: {
      saveSurveyDefinition: config.limits.maxDocumentBytes,
      saveSurveyTheme: config.limits.maxDocumentBytes,
    },
  });

  if (config.apiDocs) registerApiDocs(app, options.apiDocsPath ?? defaultApiDocsPath);

  app.addHook("onClose", async () => {
    await providers.close();
  });

  return app;
}
