import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { AppConfig } from "./config.js";
import { PROBLEM_CONTENT_TYPE, problem, toProblem, type Problem } from "./errors.js";
import type { ProviderSet } from "./providers/index.js";

function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

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
    frameworkErrors: (error, request, reply) => {
      const body = toProblem(error);
      if (body.status >= 500) request.log.error({ err: error }, "framework error");
      return sendProblem(reply, body);
    },
    bodyLimit: config.limits.maxResponseBytes,
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    done(null, payload);
  });

  app.setErrorHandler((error, request, reply) => {
    const body = toProblem(error);
    if (body.status >= 500) request.log.error({ err: error }, "unhandled error");
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

  app.addHook("onClose", async () => {
    await providers.close();
  });

  return app;
}
