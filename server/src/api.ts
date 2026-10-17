import multipart from "@fastify/multipart";
import type { operations } from "@my-surveys/contract";
import type { FastifyPluginAsync, FastifyRequest, RouteHandlerMethod } from "fastify";
import { authenticationHook, type AuthenticationOptions } from "./auth/authenticate.js";
import { isJsonMediaType, type Contract, type ContractOperation } from "./contract.js";
import { AppError } from "./errors.js";

export type OperationId = keyof operations;

/** Handlers keyed by `operationId`; an operation without one answers 501. */
export type Handlers = Partial<Record<OperationId, RouteHandlerMethod>>;

/** Requests per time window (milliseconds) per client IP. */
export interface RateLimit {
  readonly max: number;
  readonly timeWindow: number;
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
  const { contract, handlers, authentication, rateLimits = {}, bodyLimits = {} } = options;
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

  for (const op of contract.operations) {
    const operationId = op.operationId as OperationId;
    const onRequest = authenticationHook(op.security, authentication);
    const rateLimit = rateLimits[operationId];
    const bodyLimit = bodyLimits[operationId];
    api.route({
      method: op.method,
      url: op.url,
      schema: { ...op.schema },
      ...(onRequest && { onRequest }),
      ...(rateLimit && { config: { rateLimit } }),
      ...(bodyLimit !== undefined && { bodyLimit }),
      ...(op.requestBody && { preValidation: bodyGuard(op.requestBody) }),
      handler: handlers[operationId] ?? notImplemented(op.operationId),
    });
  }
};
