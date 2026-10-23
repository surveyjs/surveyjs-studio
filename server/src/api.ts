import multipart from "@fastify/multipart";
import type { operations } from "@my-surveys/contract";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { authenticationHook, type AuthenticationOptions } from "./auth/authenticate.js";
import { isJsonMediaType, type Contract, type ContractOperation } from "./contract.js";
import { AppError } from "./errors.js";
import { refusedWhenReadOnly, refuseReadOnly } from "./read-only.js";

export type OperationId = keyof operations;

/** Handlers keyed by `operationId`; an operation without one answers 501. */
export type Handlers = Partial<Record<OperationId, RouteHandlerMethod>>;

/** Requests per time window (milliseconds) per client IP. */
export interface RateLimit {
  readonly max: number;
  readonly timeWindow: number;
  /** The 429 detail; `after` is the plugin's wording of the wait, such as "42 seconds". */
  readonly detail: (after: string) => string;
}

export interface ApiOptions {
  readonly contract: Contract;
  readonly handlers: Handlers;
  /** Applies each operation's contract security (session, CSRF) before validation. */
  readonly authentication: AuthenticationOptions;
  /** Operations limited per client IP (needs `@fastify/rate-limit` registered with `global: false`). */
  readonly rateLimits?: Partial<Record<OperationId, RateLimit>>;
  /** Request body limit in bytes of the operations that need more (or less) than the server's. */
  readonly bodyLimits?: Partial<Record<OperationId, number>>;
  /**
   * Operations whose handler reads the raw body: registered in their own plugin scope whose only
   * content-type parser is a catch-all (`*`, `parseAs: "string"`, the text kept as is), without the
   * body and header schemas and without the media-type guard; `request.body` is the text, or
   * undefined when there is none.
   */
  readonly rawBodyOperations?: readonly OperationId[];
  /**
   * `READ_ONLY=true`: every operation `refusedWhenReadOnly` names answers `503 read-only` from its
   * first `onRequest` hook, before authentication, body parsing, validation and the handler.
   */
  readonly readOnly?: boolean;
}

/**
 * Busboy limits of every multipart body (R12): one file, a few small fields. Uploads add their own
 * `fileSize` (the default is the server's body limit).
 */
export const MULTIPART_LIMITS = {
  files: 1,
  fields: 10,
  fieldSize: 1024,
  parts: 20,
  headerPairs: 100,
} as const;

function notImplemented(operationId: string): RouteHandlerMethod {
  return () => {
    throw new AppError({
      code: "not-implemented",
      status: 501,
      title: "Not implemented",
      detail: `Operation ${operationId} is not implemented yet.`,
    });
  };
}

function mediaTypeOf(request: FastifyRequest): string | undefined {
  return request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

/**
 * Checks what Fastify's body validation cannot: a required body is present, and the
 * body uses a media type the operation declares (otherwise its schema would be skipped).
 */
function bodyGuard(
  body: NonNullable<ContractOperation["requestBody"]>,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    // A multipart body is read by the handler (request.file()), so it never sets request.body.
    if (request.body === undefined && !request.isMultipart()) {
      if (!body.required) return;
      throw new AppError({
        code: "validation-failed",
        status: 422,
        title: "Validation failed",
        errors: [{ pointer: "", detail: "Request body is required" }],
      });
    }
    const mediaType = mediaTypeOf(request);
    if (mediaType === undefined || !body.mediaTypes.includes(mediaType)) {
      throw new AppError({
        code: "unsupported-media-type",
        status: 415,
        title: "Unsupported media type",
        detail: `Send the body as ${body.mediaTypes.join(" or ")}.`,
      });
    }
  };
}

/**
 * Registers every contract operation as a route (mount it under `/api/v1`), with authentication
 * from the contract's security requirements and request validation from its schemas.
 */
export const apiRoutes: FastifyPluginAsync<ApiOptions> = async (api, options) => {
  const {
    contract,
    handlers,
    authentication,
    rateLimits = {},
    bodyLimits = {},
    rawBodyOperations = [],
    readOnly = false,
  } = options;
  api.setValidatorCompiler(contract.compileValidator);
  api.decorateRequest("user", null);
  // Parses multipart/form-data lazily, in the handler. Fastify's bodyLimit does not apply to it;
  // the busboy limits do. Registered first, so the loop below finds its parser.
  await api.register(multipart, { limits: MULTIPART_LIMITS });

  const mediaTypes = new Set(contract.operations.flatMap((op) => op.requestBody?.mediaTypes ?? []));
  for (const mediaType of mediaTypes) {
    if (api.hasContentTypeParser(mediaType)) continue;
    if (isJsonMediaType(mediaType)) {
      const { onProtoPoisoning = "error", onConstructorPoisoning = "error" } = api.initialConfig;
      api.addContentTypeParser(
        mediaType,
        { parseAs: "string" },
        api.getDefaultJsonParser(onProtoPoisoning, onConstructorPoisoning),
      );
    } else {
      throw new Error(`No body parser for ${mediaType}`);
    }
  }

  const raw = new Set<string>(rawBodyOperations);
  const route = (scope: typeof api, op: ContractOperation, rawBody: boolean) => {
    const operationId = op.operationId as OperationId;
    // A refused operation's only hook is the refusal: no authentication, body parsing, validation
    // or handler runs (the rate limit appends its hook after it).
    const onRequest =
      readOnly && refusedWhenReadOnly(op)
        ? refuseReadOnly
        : authenticationHook(op.security, authentication);
    // The operation is known only here: its log lines, "request completed" included, carry it.
    const tagOperation = (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      request.log = request.log.child({ operationId });
      reply.log = request.log;
      done();
    };
    const rateLimit = rateLimits[operationId];
    const bodyLimit = bodyLimits[operationId];
    // A raw-body handler checks the text itself: no body or header schema, no media-type guard.
    const { params, querystring } = op.schema;
    const schema = rawBody
      ? { ...(params && { params }), ...(querystring && { querystring }) }
      : { ...op.schema };
    scope.route({
      method: op.method,
      url: op.url,
      schema,
      onRequest: onRequest ? [tagOperation, onRequest] : [tagOperation],
      ...(rateLimit && {
        config: {
          rateLimit: {
            max: rateLimit.max,
            timeWindow: rateLimit.timeWindow,
            errorResponseBuilder: (_request: FastifyRequest, context: { after: string }) =>
              new AppError({
                code: "rate-limited",
                status: 429,
                title: "Too many requests",
                detail: rateLimit.detail(context.after),
              }),
          },
        },
      }),
      ...(bodyLimit !== undefined && { bodyLimit }),
      ...(op.requestBody && !rawBody && { preValidation: bodyGuard(op.requestBody) }),
      handler: handlers[operationId] ?? notImplemented(op.operationId),
    });
  };

  for (const op of contract.operations) {
    if (!raw.has(op.operationId)) route(api, op, false);
  }
  const rawOperations = contract.operations.filter((op) => raw.has(op.operationId));
  if (rawOperations.length > 0) {
    await api.register(async (scope) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser("*", { parseAs: "string" }, (_request, text, done) => {
        done(null, text);
      });
      for (const op of rawOperations) route(scope, op, true);
    });
  }
};
