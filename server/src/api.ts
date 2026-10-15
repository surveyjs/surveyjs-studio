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
}

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
    if (request.body === undefined) {
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
export const apiRoutes: FastifyPluginAsync<ApiOptions> = (api, options) => {
  const { contract, handlers, authentication, rateLimits = {} } = options;
  api.setValidatorCompiler(contract.compileValidator);
  api.decorateRequest("user", null);

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
      // Not parsed yet (e.g. multipart/form-data): the handler receives the raw stream.
      // TODO: replace with @fastify/multipart and per-route limits (maxFileBytes, the asset
      // limits) in Step 7 (editor uploads) and Step 8 (respondent files). This pass-through
      // bypasses Fastify's bodyLimit for these media types, but never buffers the body.
      api.addContentTypeParser(mediaType, (_request, payload, done) => {
        done(null, payload);
      });
    }
  }

  for (const op of contract.operations) {
    const operationId = op.operationId as OperationId;
    const onRequest = authenticationHook(op.security, authentication);
    const rateLimit = rateLimits[operationId];
    api.route({
      method: op.method,
      url: op.url,
      schema: { ...op.schema },
      ...(onRequest && { onRequest }),
      ...(rateLimit && { config: { rateLimit } }),
      ...(op.requestBody && { preValidation: bodyGuard(op.requestBody) }),
      handler: handlers[operationId] ?? notImplemented(op.operationId),
    });
  }
  return Promise.resolve();
};
