import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { openapiPath } from "@my-surveys/contract";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { createEraseAccount } from "./accounts/erasure.js";
import { createAccountHandlers } from "./accounts/handlers.js";
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
import { REDACTED_LOG_PATHS, serializeRequest } from "./logging.js";
import { createProjectHandlers } from "./projects/handlers.js";
import type { ProviderSet } from "./providers/index.js";
import { createContentHandlers } from "./content/handlers.js";
import { createFileHandlers } from "./files/handlers.js";
import { createResultHandlers } from "./results/handlers.js";
import { serverSecurityHeaders } from "./security-headers.js";
import { createSurveyHandlers } from "./surveys/handlers.js";
import { createViewHandlers } from "./views/handlers.js";
import { securityHeaders } from "./web/security-headers.js";
import { isServerPath, registerWebApp, requestPathname } from "./web/static.js";

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
  "getPublicResults",
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
            redact: [...REDACTED_LOG_PATHS],
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

  const https = new URL(config.publicBaseUrl).protocol === "https:";
  /** With `WEB_ROOT`, any path but the server's own is the web app's and gets its policy (ADR 0021). */
  function headersFor(url: string): Record<string, string> {
    const pathname = requestPathname(url);
    if (config.webRoot === null || isServerPath(pathname)) {
      return serverSecurityHeaders(url, { https });
    }
    return Object.fromEntries(
      Object.entries(securityHeaders(pathname, { https })).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
  }
  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    // A route's own header wins: the dev sign-in page and file downloads set a CSP of their own.
    for (const [name, value] of Object.entries(headersFor(request.url))) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
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
    // A check that cannot run counts as failed, and the answer never names less than all of them.
    const checks = await providers.ready().catch(() => null);
    const failing =
      checks === null
        ? [...providers.readinessNames]
        : checks.filter((check) => !check.ok).map((check) => check.name);
    if (failing.length === 0) return reply.send({ status: "ok" });
    return reply.code(503).send({ status: "unavailable", failing });
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
        users: providers.users,
        notices: providers.notices,
        ...(options.now && { now: options.now }),
      }),
      ...createProjectHandlers({
        users: providers.users,
        projects: providers.projects,
        ...(options.now && { now: options.now }),
      }),
      ...createContentHandlers({
        surveys: providers.surveys,
        users: providers.users,
        projects: providers.projects,
        ...(options.now && { now: options.now }),
      }),
      ...createSurveyHandlers({
        surveys: providers.surveys,
        projects: providers.projects,
        files: providers.files,
        views: providers.views,
        ...(options.now && { now: options.now }),
      }),
      ...createResultHandlers({
        surveys: providers.surveys,
        projects: providers.projects,
        results: providers.results,
        files: providers.files,
        views: providers.views,
        ...(options.now && { now: options.now }),
      }),
      ...createViewHandlers({
        surveys: providers.surveys,
        projects: providers.projects,
        views: providers.views,
      }),
      ...createFileHandlers({
        surveys: providers.surveys,
        projects: providers.projects,
        files: providers.files,
        publicBaseUrl: config.publicBaseUrl,
        maxAssetBytesPerSurvey: config.limits.maxAssetBytesPerSurvey,
        maxFileBytes: config.limits.maxFileBytes,
        ...(options.now && { now: options.now }),
      }),
      ...createAccountHandlers({
        webhookSecret: config.accountWebhookSecret,
        eraseAccount: createEraseAccount(
          { surveys: providers.surveys, projects: providers.projects, files: providers.files },
          app.log,
        ),
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
      // The account-deleted webhook carries a small event; anything larger is refused unread.
      receiveAccountDeleted: 65_536,
    },
    // The webhook's signature covers the body exactly as sent: it is checked before parsing.
    rawBodyOperations: ["receiveAccountDeleted"],
  });

  if (config.apiDocs) registerApiDocs(app, options.apiDocsPath ?? defaultApiDocsPath);

  // Last: its catch-all answers only the GET and HEAD paths no route above took.
  if (config.webRoot !== null) await registerWebApp(app, config.webRoot);

  app.addHook("onClose", async () => {
    await providers.close();
  });

  return app;
}
