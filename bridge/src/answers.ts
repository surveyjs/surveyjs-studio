// The old API's answer building blocks (ADR 0039 point 1: exact wherever a caller can depend on
// it). Each action answers with these, so status, content type and body shape match the old API.
import { randomBytes } from "node:crypto";
import type { FastifyReply } from "fastify";

const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/**
 * The content type of a JSON answer, negotiated as the old API did: without an `Accept`, or with
 * one holding `*\/*` (what browsers, jQuery and fetch send), `application/json`; otherwise the
 * first acceptable JSON type by quality (`text/json` or `text/*` → `text/json`), and
 * `application/json` when none is.
 */
export function jsonContentType(accept: string | undefined): string {
  const json = "application/json; charset=utf-8";
  if (accept === undefined) return json;
  const ranges = accept
    .split(",")
    .map((part, index) => {
      const [type = "", ...params] = part.split(";").map((piece) => piece.trim().toLowerCase());
      const q = params.find((param) => param.startsWith("q="));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { type, quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter((range) => range.type !== "" && range.quality > 0);
  if (ranges.length === 0 || ranges.some((range) => range.type === "*/*")) return json;
  ranges.sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { type } of ranges) {
    if (type === "application/json" || type === "application/*") return json;
    if (type === "text/json" || type === "text/*") return "text/json; charset=utf-8";
  }
  return json;
}

/** A JSON body already serialized; the content type follows the request's `Accept`. */
function sendJsonText(reply: FastifyReply, status: number, text: string): FastifyReply {
  return reply
    .code(status)
    .header("content-type", jsonContentType(reply.request.headers.accept))
    .send(text);
}

/** **JSON string**: the text as a JSON string literal (`"Check parameter values."`). */
export function sendJsonString(reply: FastifyReply, status: number, text: string): FastifyReply {
  return sendJsonText(reply, status, JSON.stringify(text));
}

/** **JSON null**: `200` with the body `null`. */
export function sendJsonNull(reply: FastifyReply): FastifyReply {
  return sendJsonText(reply, 200, "null");
}

/** A JSON value with its property names as given (the old API's are PascalCase). */
export function sendJson(reply: FastifyReply, status: number, value: unknown): FastifyReply {
  return sendJsonText(reply, status, JSON.stringify(value) ?? "null");
}

/** **Empty 200/400/401/404/413/429/500/503**: no body, `Content-Length: 0`, no `Content-Type`. */
export function sendEmpty(
  reply: FastifyReply,
  status: 200 | 400 | 401 | 404 | 413 | 429 | 500 | 503,
): FastifyReply {
  return reply.code(status).removeHeader("content-type").send();
}

/** **Text-200**: the old API's service error, a message as raw `text/html`. */
export function sendText(reply: FastifyReply, text: string): FastifyReply {
  return reply.code(200).header("content-type", "text/html; charset=utf-8").send(text);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The text with `&`, `<`, `>`, `"` and `'` as HTML entities, safe inside `text/html`. */
export function htmlEncode(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** A per-request trace ID in the W3C form the old API's monitoring gave its error bodies. */
function traceId(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-00`;
}

const PROBLEMS = {
  400: { type: "https://tools.ietf.org/html/rfc9110#section-15.5.1", title: "Bad Request" },
  404: { type: "https://tools.ietf.org/html/rfc9110#section-15.5.5", title: "Not Found" },
  415: {
    type: "https://tools.ietf.org/html/rfc9110#section-15.5.16",
    title: "Unsupported Media Type",
  },
} as const;

/** **ProblemDetails** for a client error of the public actions (`400`, `404`, `415`). */
export function sendProblem(reply: FastifyReply, status: 400 | 404 | 415): FastifyReply {
  const body = { ...PROBLEMS[status], status, traceId: traceId() };
  return reply.code(status).header("content-type", PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

/**
 * **ProblemDetails validation `400`**: a parameter the old API could not bind. `errors` maps the
 * parameter name (`""` for an empty body) to its messages, and comes first.
 */
export function sendValidationProblem(
  reply: FastifyReply,
  errors: Record<string, string[]>,
): FastifyReply {
  const body = {
    errors,
    type: PROBLEMS[400].type,
    title: "One or more validation errors occurred.",
    status: 400,
    traceId: traceId(),
  };
  return reply.code(400).header("content-type", PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}
