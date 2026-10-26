import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openapiPath } from "@surveyjs-studio/contract";
import type { FastifyInstance } from "fastify";
import { AppError } from "./errors.js";

/** Built by `pnpm build:docs` (git-ignored). */
export const defaultApiDocsPath = join(dirname(openapiPath), "dist", "reference.html");

/** `GET /api/docs`: the self-contained API reference, read on each request. */
export function registerApiDocs(app: FastifyInstance, docsPath: string): void {
  app.get("/api/docs", async (_request, reply) => {
    const html = await readFile(docsPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new AppError({
        code: "not-found",
        status: 404,
        title: "Not found",
        detail: "Run pnpm build:docs",
      });
    });
    return reply.type("text/html; charset=utf-8").send(html);
  });
}
