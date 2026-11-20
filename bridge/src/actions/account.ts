// The old API's actions on the caller's own account (reference behaviour: ADR 0040 point 2):
// `generateAccessKey` replaces the credential the request carries, `setGenerationJSONType` only
// checks the key. Both run behind their key rule (`withKeyRule`, key.ts): a missing or refused key
// never gets here, or gets its bad-key answer from Studio's `401`.
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendEmpty, sendJsonString } from "../answers.js";
import { contextOf } from "../context.js";
import { studioFor } from "../key.js";
import { unexpectedStatus } from "../studio.js";

/**
 * `generateAccessKey`: an API token is rotated and its new value answered as a JSON string. A
 * legacy access key lives in the old service until the keys move into Studio (ADR 0037 point 5):
 * Studio refuses to replace it, and the request goes to the old service unchanged.
 */
export async function generateAccessKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const context = contextOf(request);
  const { data, error, response } = await studioFor(request, context.settings).POST(
    "/me/credential",
  );
  if (data !== undefined) return sendJsonString(reply, 200, data.value);
  if (response.status === 409 && error?.code === "legacy-key-replace-unavailable") {
    // A GET: its body, if any, has not been read.
    context.forward(request, reply);
    return reply;
  }
  return unexpectedStatus(response);
}

/**
 * `setGenerationJSONType`: the key is checked and nothing is stored (ADR 0040 point 1: only the
 * old site's editor read the setting).
 */
export async function setGenerationJSONType(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const { data, response } = await studioFor(request, contextOf(request).settings).GET("/me");
  if (data === undefined) return unexpectedStatus(response);
  return sendEmpty(reply, 200);
}
