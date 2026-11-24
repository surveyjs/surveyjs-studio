// The old API's content actions (reference behaviour: ADR 0040): saving a survey's definition and
// theme, reading a history point, and uploading editor files, through Studio's definition, theme,
// history and legacy-file operations with the caller's key. Studio's permissions apply (ADR 0009);
// a survey Studio does not show the caller (`404`) or does not let them change (`403`) gets the
// action's old "You are not authorized …" answer. There are no My Surveys card images (ADR 0040
// point 1): nothing here drops one, and every upload gets a new name.
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { sendEmpty, sendJson, sendJsonString, sendJsonText } from "../answers.js";
import { boundGuid, boundValue, formOf, parseGuid } from "../binding.js";
import { contextOf } from "../context.js";
import { bindJsonBody, parseLenientJson } from "../json-body.js";
import { keyOf, studioFor } from "../key.js";
import { unexpectedStatus, type StudioClient } from "../studio.js";

const MODIFY = "You are not authorized to modify the survey";
const READ_HISTORY = "You are not authorized to read the history of the survey";

/** The documentation's placeholder key: `uploadFiles` answers without storing anything. */
const PLACEHOLDER_KEY = "<your_access_key>";

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

function studio(request: FastifyRequest): StudioClient {
  return studioFor(request, contextOf(request).settings);
}

/** Studio does not show the survey to the caller, or does not let them change it. */
const isRefusal = (status: number) => status === 403 || status === 404;

function notAuthorized(reply: FastifyReply, message: string, id: string): FastifyReply {
  return sendJsonString(reply, 400, `${message} ${id}`);
}

/** The JSON types the old API read a body as: `application/json`, `text/json`, `application/*+json`. */
export function isJson(request: FastifyRequest): boolean {
  const type = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  return (
    type === "application/json" || type === "text/json" || /^application\/[^/]+\+json$/.test(type)
  );
}

/** `text` read as a JSON object (the old lenient syntax); `undefined` for anything else. */
function jsonObject(text: string): Record<string, unknown> | undefined {
  const value = parseLenientJson(text)?.value;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The old API stored nothing for an empty text but still changed the survey's time; an update that
 * keeps the archived state does that here (Studio's update needs a field). `refused` when Studio
 * does not show the survey or does not let the caller change it.
 */
async function touch(client: StudioClient, surveyId: string): Promise<"done" | "refused"> {
  const read = await client.GET("/surveys/{surveyId}", { params: { path: { surveyId } } });
  if (isRefusal(read.response.status)) return "refused";
  if (read.data === undefined) return unexpectedStatus(read.response);
  const { data, response } = await client.PATCH("/surveys/{surveyId}", {
    params: { path: { surveyId } },
    body: { archived: read.data.archived },
  });
  if (data !== undefined) return "done";
  if (isRefusal(response.status)) return "refused";
  return unexpectedStatus(response);
}

/**
 * A save of a survey's text (`changeJson`, `changeTheme`): the body is JSON naming the survey
 * (`Id`) and the text; a missing or empty text only changes the survey's time, any other text
 * must be a JSON object (else an empty `400`, after the permission check, which the old API made
 * first). `save` sends the object to Studio and answers its status.
 */
function textAction(
  properties: Record<"id" | "text" | "other", string>,
  save: (client: StudioClient, id: string, value: Record<string, unknown>) => Promise<number>,
  /** What an empty (`""`) text stores, `undefined`: only the survey's time changes. */
  whenEmpty: Record<string, unknown> | undefined,
): RouteHandlerMethod {
  const shape = {
    [properties.id]: "guid",
    [properties.text]: "string",
    [properties.other]: "string",
  } as const;
  return async function saveText(request, reply) {
    if (!isJson(request)) return sendEmpty(reply, 415);
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const { model, errors } = bindJsonBody(new TextDecoder().decode(bytes), shape);
    // No model (empty body, `null`) or any binding error: the old action's `data` was `null`.
    if (model === null || Object.keys(errors).length > 0) return sendEmpty(reply, 400);
    const record = model as Record<string, string | null | undefined>;
    const id = record[properties.id] ?? ZERO_GUID;
    const text = record[properties.text];
    const client = studio(request);

    let value: Record<string, unknown> | undefined;
    if (text === undefined || text === null || (text === "" && whenEmpty === undefined)) {
      value = undefined;
    } else {
      value = text === "" ? whenEmpty : jsonObject(text);
      if (value === undefined) {
        // The permission answer comes first, as in the old API.
        const read = await client.GET("/surveys/{surveyId}", {
          params: { path: { surveyId: id } },
        });
        if (isRefusal(read.response.status)) return notAuthorized(reply, MODIFY, id);
        if (read.data === undefined) return unexpectedStatus(read.response);
        return sendEmpty(reply, 400);
      }
    }

    if (value === undefined) {
      return (await touch(client, id)) === "refused"
        ? notAuthorized(reply, MODIFY, id)
        : sendEmpty(reply, 200);
    }
    const status = await save(client, id, value);
    if (status === 204) return sendEmpty(reply, 200);
    if (isRefusal(status)) return notAuthorized(reply, MODIFY, id);
    // A text Studio refuses (it is not stored: the old API's failed write).
    if (status === 400 || status === 413 || status === 422) return sendEmpty(reply, 400);
    throw new Error(`unexpected status ${status} from Studio`);
  };
}

/**
 * `changeJson`: `{ Id, Json, Text }`; `Json` is saved as the survey's definition (a history entry
 * is added), `Text` is ignored.
 */
export const changeJson = textAction(
  { id: "Id", text: "Json", other: "Text" },
  async (client, surveyId, definition) => {
    const { response } = await client.PUT("/surveys/{surveyId}/definition", {
      params: { path: { surveyId }, header: { "If-Match": "*" } },
      body: definition,
    });
    return response.status;
  },
  undefined,
);

/**
 * `changeTheme`: `{ Id, ThemeJson, SurveyJson }`; `ThemeJson` is saved as the theme (`""` is an
 * empty theme, null leaves it as it is), `SurveyJson` is ignored.
 */
export const changeTheme = textAction(
  { id: "Id", text: "ThemeJson", other: "SurveyJson" },
  async (client, surveyId, theme) => {
    const { response } = await client.PUT("/surveys/{surveyId}/theme", {
      params: { path: { surveyId }, header: { "If-Match": "*" } },
      body: theme,
    });
    return response.status;
  },
  {},
);

/**
 * `getHistoryPoint`: the definition stored in history entry `pointId`, as compact JSON (dates not
 * rewritten, ADR 0039). An entry that does not exist is "Check parameter values."
 */
export async function getHistoryPoint(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const surveyId = await boundGuid(request, "id");
  const pointText = await boundValue(request, "pointId");
  const pointId = (pointText === undefined ? null : parseGuid(pointText)) ?? ZERO_GUID;
  const { data, response } = await client.GET("/surveys/{surveyId}/history/{entryId}", {
    params: { path: { surveyId, entryId: pointId } },
  });
  if (data !== undefined) return sendJson(reply, 200, data);
  if (response.status !== 404 && response.status !== 400) return unexpectedStatus(response);
  // Missing survey or missing entry: the old API checked the survey first.
  const read = await client.GET("/surveys/{surveyId}", { params: { path: { surveyId } } });
  if (isRefusal(read.response.status)) return notAuthorized(reply, READ_HISTORY, surveyId);
  if (read.data === undefined) return unexpectedStatus(read.response);
  return sendJsonString(reply, 400, "Check parameter values.");
}

/**
 * `uploadFiles`: every file of the request's form (any field name), stored through
 * `uploadLegacyFile` in form order; the answer maps each client file name to the stored name (a
 * repeated name keeps the last). The documentation's placeholder key stores nothing and maps every
 * file to the zero GUID. A body that is not a form is an empty `400`.
 */
export async function uploadFiles(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const placeholder = keyOf(request) === PLACEHOLDER_KEY;
  const client = placeholder ? undefined : studio(request);
  // The old API checked the key before it read the form.
  if (client !== undefined) {
    const me = await client.GET("/me");
    if (me.data === undefined) return unexpectedStatus(me.response);
  }
  const form = await formOf(request);
  if (form === null) return sendEmpty(reply, 400);

  // A Map keeps a repeated name where it first stood and takes the last value; an object would
  // reorder numeric names.
  const names = new Map<string, string>();
  for (const [, value] of form) {
    if (typeof value === "string" || value.name === "") continue;
    if (client === undefined) {
      names.set(value.name, ZERO_GUID);
      continue;
    }
    const upload = new FormData();
    upload.append("file", value, value.name);
    const { data, response } = await client.POST("/legacy-files", {
      body: upload as unknown as { file: string },
      bodySerializer: (body) => body as unknown as FormData,
    });
    if (data !== undefined) {
      names.set(value.name, data.legacyName);
    } else if (response.status === 400 || response.status === 413) {
      // A file Studio does not take: the old API's failed write.
      return sendEmpty(reply, 400);
    } else {
      return unexpectedStatus(response);
    }
  }
  const members = [...names].map(
    ([name, stored]) => `${JSON.stringify(name)}:${JSON.stringify(stored)}`,
  );
  return sendJsonText(reply, 200, `{${members.join(",")}}`);
}
