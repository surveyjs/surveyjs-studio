import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { PROBLEM_CONTENT_TYPE, problem, toProblem } from "./errors.js";
import type { ProviderSet } from "./providers/index.js";

export async function buildApp(
  config: AppConfig,
  providers: ProviderSet,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel },
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && incoming !== "" && incoming.length <= 128
        ? incoming
        : randomUUID();
    },
    bodyLimit: config.limits.maxFileBytes,
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    done(null, payload);
  });

  app.setErrorHandler((error, request, reply) => {
    const body = toProblem(error);
    if (body.status >= 500) request.log.error({ err: error }, "unhandled error");
    return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
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

  app.addHook("onClose", async () => {
    await providers.close();
  });

  return app;
}
