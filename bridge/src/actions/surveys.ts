// The old API's survey record actions (reference behaviour: ADR 0040): lists, the record, create,
// archive, delete, rename, publishing, the settings, clone and moving a survey, through Studio's
// survey operations with the caller's key. Studio's permissions apply (ADR 0009); a survey Studio
// does not show the caller (`404`) or does not let them change (`403`) gets the action's old
// "You are not authorized …" answer. Every action runs behind its key rule (`withKeyRule`,
// key.ts).
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import type { components } from "@surveyjs-studio/contract/types";
import { sendEmpty, sendJson, sendJsonString, sendText } from "../answers.js";
import { boundBool, boundGuid, boundValue, EMPTY_GUID, parseGuid } from "../binding.js";
import { contextOf } from "../context.js";
import { studioFor } from "../key.js";
import { legacySurvey, netHtmlEncode, type Survey } from "../legacy-survey.js";
import { StudioFailure, unexpectedStatus, type StudioClient } from "../studio.js";

type SurveyPatch = components["schemas"]["SurveyPatch"];

const MODIFY = "You are not authorized to modify the survey";
const GET_INFORMATION = "You are not authorized to get this information about the survey";
const ACCESS_DENIED = "Something going wrong. Access denied.";

/** The largest page `listSurveys` gives. */
const PAGE_LIMIT = 200;

function studio(request: FastifyRequest): StudioClient {
  return studioFor(request, contextOf(request).settings);
}

/** The old refusal: `400` with the message and the survey's ID as a JSON string. */
function notAuthorized(reply: FastifyReply, message: string, id: string): FastifyReply {
  return sendJsonString(reply, 400, `${message} ${id}`);
}

/** Studio does not show the survey to the caller, or does not let them change it. */
const isRefusal = (status: number) => status === 403 || status === 404;

/** The caller's own user ID: the owner of every Personal survey they see (ADR 0009). */
async function callerId(client: StudioClient): Promise<string> {
  const { data, response } = await client.GET("/me");
  if (data === undefined) return unexpectedStatus(response);
  return data.id;
}

/**
 * The caller's ID when a record needs it (a Personal survey among `surveys`); otherwise unused,
 * and not asked for.
 */
async function personalOwner(client: StudioClient, surveys: readonly Survey[]): Promise<string> {
  return surveys.some((survey) => survey.projectId === null) ? callerId(client) : EMPTY_GUID;
}

/** The `ownerId` parameter as a GUID, `undefined` when it is missing or no GUID. */
async function ownerIdOf(request: FastifyRequest): Promise<string | undefined> {
  const text = await boundValue(request, "ownerId");
  return (text === undefined ? null : parseGuid(text)) ?? undefined;
}

/**
 * `updateSurvey`: the updated survey; `refused` when Studio does not show the survey to the caller
 * or does not let them make the change, `invalid` when it refuses the values (`422`).
 */
async function updateSurvey(
  client: StudioClient,
  surveyId: string,
  patch: SurveyPatch,
): Promise<Survey | "refused" | "invalid"> {
  const { data, response } = await client.PATCH("/surveys/{surveyId}", {
    params: { path: { surveyId } },
    body: patch,
  });
  if (data !== undefined) return data;
  if (isRefusal(response.status)) return "refused";
  if (response.status === 422) return "invalid";
  return unexpectedStatus(response);
}

/** For an update whose values Studio should always take: its refusal is unexpected. */
function invalidUpdate(): never {
  throw new StudioFailure(500, "Studio refused the values of an update");
}

/**
 * Every page of the surveys in `project` (`undefined`: the caller's own space, Personal for a key),
 * archived or active, with their themes; `undefined` when Studio has no such project for the
 * caller.
 */
async function listAll(
  client: StudioClient,
  archived: boolean,
  project: string | undefined,
): Promise<Survey[] | undefined> {
  const surveys: Survey[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data, response } = await client.GET("/surveys", {
      params: {
        query: {
          archived,
          include: "theme",
          limit: PAGE_LIMIT,
          ...(project !== undefined && { project }),
          ...(cursor !== undefined && { cursor }),
        },
      },
    });
    if (response.status === 404 && cursor === undefined && project !== undefined) return undefined;
    if (data === undefined) return unexpectedStatus(response);
    surveys.push(...data.items);
    if (data.nextCursor === null) return surveys;
    cursor = data.nextCursor;
  }
}

/**
 * `getActive` and `getArchive`: the surveys of `ownerId` when it is a project the caller can see,
 * otherwise of the caller (as the old API fell back for a non-member), newest first, every one with
 * its theme, list dates with `Z`.
 */
function surveyList(archived: boolean): RouteHandlerMethod {
  return async function list(request, reply) {
    const client = studio(request);
    const ownerId = await ownerIdOf(request);
    // Only a named project can be missing: the caller's own space always answers.
    const surveys =
      (ownerId === undefined ? undefined : await listAll(client, archived, ownerId)) ??
      (await listAll(client, archived, undefined))!;
    const owner = await personalOwner(client, surveys);
    return sendJson(
      reply,
      200,
      surveys.map((survey) => legacySurvey(survey, "list", owner)),
    );
  };
}

export const getActive = surveyList(false);
export const getArchive = surveyList(true);

/**
 * `getSurveyInfo`: the record (single-read dates) and the definition, HTML-encoded. A survey
 * Studio does not show is an empty `400`, as the old API's unknown survey. A project survey is
 * read only when `ownerId` names its project, as the old API compared the owner; otherwise the
 * old failure, an empty `500`.
 */
export async function getSurveyInfo(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const surveyId = await boundGuid(request, "surveyId");
  const ownerId = await ownerIdOf(request);
  const read = await client.GET("/surveys/{surveyId}", { params: { path: { surveyId } } });
  if (isRefusal(read.response.status)) return sendEmpty(reply, 400);
  if (read.data === undefined) return unexpectedStatus(read.response);
  const survey = read.data;
  if (survey.projectId !== null && survey.projectId.toLowerCase() !== ownerId) {
    return sendEmpty(reply, 500);
  }
  const path = { params: { path: { surveyId } } };
  const [theme, definition, owner] = await Promise.all([
    client.GET("/surveys/{surveyId}/theme", path),
    client.GET("/surveys/{surveyId}/definition", { ...path, parseAs: "text" }),
    personalOwner(client, [survey]),
  ]);
  // Deleted meanwhile: as unknown.
  if (isRefusal(theme.response.status) || isRefusal(definition.response.status)) {
    return sendEmpty(reply, 400);
  }
  if (theme.data === undefined) return unexpectedStatus(theme.response);
  if (definition.data === undefined) return unexpectedStatus(definition.response);
  return sendJson(reply, 200, {
    Info: legacySurvey({ ...survey, theme: theme.data }, "single", owner),
    Json: netHtmlEncode(definition.data),
  });
}

/**
 * `create`: an empty survey named `name` (Studio picks the name when none is given), in the
 * project `ownerId` names when the caller may create there, otherwise in the caller's own space.
 * A name Studio refuses is an empty `400`, as the old API's failed insert.
 */
export async function create(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const client = studio(request);
  const name = await boundValue(request, "name");
  const ownerId = await ownerIdOf(request);
  const createIn = (projectId: string | undefined) =>
    client.POST("/surveys", {
      body: {
        ...(name !== undefined && name !== "" && { name }),
        ...(projectId !== undefined && { projectId }),
        definition: {},
      },
    });
  let created = await createIn(ownerId);
  if (ownerId !== undefined && isRefusal(created.response.status)) {
    created = await createIn(undefined);
  }
  const { data, response } = created;
  if (response.status === 400 || response.status === 422) return sendEmpty(reply, 400);
  if (data === undefined) return unexpectedStatus(response);
  return sendJson(reply, 200, legacySurvey(data, "single", await personalOwner(client, [data])));
}

/**
 * An action that changes the survey `id` with one `updateSurvey` and answers from the updated
 * survey; a refusal is the old "modify" answer.
 */
function patchAction(
  patchOf: (request: FastifyRequest) => Promise<SurveyPatch>,
  answer: (reply: FastifyReply, survey: Survey) => FastifyReply,
): RouteHandlerMethod {
  return async function patch(request, reply) {
    const id = await boundGuid(request, "id");
    const updated = await updateSurvey(studio(request), id, await patchOf(request));
    if (updated === "refused") return notAuthorized(reply, MODIFY, id);
    if (updated === "invalid") return invalidUpdate();
    return answer(reply, updated);
  };
}

const answerEmpty = (reply: FastifyReply) => sendEmpty(reply, 200);

export const archive = patchAction(async () => ({ archived: true }), answerEmpty);
export const restore = patchAction(async () => ({ archived: false }), answerEmpty);
export const publish = patchAction(async () => ({ published: true }), answerEmpty);
export const unPublish = patchAction(async () => ({ published: false }), answerEmpty);

/** `setUseCookies`: answers `true` whatever it stored, as the old API. */
export const setUseCookies = patchAction(
  async (request) => ({ settings: { useCookies: await boundBool(request, "useCookies") } }),
  (reply) => sendJson(reply, 200, true),
);

/** `makeResultPublic`: answers the stored value. */
export const makeResultPublic = patchAction(
  async (request) => ({
    settings: { publicResults: await boundBool(request, "makeResultPublic") },
  }),
  (reply, survey) => sendJson(reply, 200, survey.settings.publicResults === true),
);

/** `storeIPAddressInResult`: answers the stored value. */
export const storeIPAddressInResult = patchAction(
  async (request) => ({
    settings: { storeRespondentIp: await boundBool(request, "storeIPAddress") },
  }),
  (reply, survey) => sendJson(reply, 200, survey.settings.storeRespondentIp === true),
);

/**
 * `delete`: the old API deleted active surveys, Studio deletes archived ones only, so an active
 * survey is archived first and then deleted (ADR 0040 point 5). A failure between the two leaves
 * it archived; a retry finishes.
 */
export async function deleteSurvey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const id = await boundGuid(request, "id");
  const remove = () => client.DELETE("/surveys/{surveyId}", { params: { path: { surveyId: id } } });
  let removed = await remove();
  if (removed.response.status === 409 && removed.error?.code === "survey-not-archived") {
    const archived = await updateSurvey(client, id, { archived: true });
    if (archived === "refused") return notAuthorized(reply, MODIFY, id);
    if (archived === "invalid") return invalidUpdate();
    removed = await remove();
  }
  if (removed.response.status === 204) return sendEmpty(reply, 200);
  if (isRefusal(removed.response.status)) return notAuthorized(reply, MODIFY, id);
  return unexpectedStatus(removed.response);
}

/**
 * `changeName`: a name sets the name; without one the old API changed nothing but the time the
 * survey changed, which an update that keeps its archived state does too (Studio's update needs
 * a field). A name Studio refuses is an empty `400`.
 */
export async function changeName(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const id = await boundGuid(request, "id");
  const name = await boundValue(request, "name");
  let patch: SurveyPatch;
  if (name !== undefined && name !== "") {
    patch = { name };
  } else {
    const read = await client.GET("/surveys/{surveyId}", { params: { path: { surveyId: id } } });
    if (isRefusal(read.response.status)) return notAuthorized(reply, MODIFY, id);
    if (read.data === undefined) return unexpectedStatus(read.response);
    patch = { archived: read.data.archived };
  }
  const updated = await updateSurvey(client, id, patch);
  if (updated === "refused") return notAuthorized(reply, MODIFY, id);
  if (updated === "invalid") return sendEmpty(reply, 400);
  return sendEmpty(reply, 200);
}

/** A read of the survey `id` answered as a JSON bool; a refusal is the old "get this information". */
function surveyFlag(flag: (survey: Survey) => boolean): RouteHandlerMethod {
  return async function read(request, reply) {
    const id = await boundGuid(request, "id");
    const { data, response } = await studio(request).GET("/surveys/{surveyId}", {
      params: { path: { surveyId: id } },
    });
    if (isRefusal(response.status)) return notAuthorized(reply, GET_INFORMATION, id);
    if (data === undefined) return unexpectedStatus(response);
    return sendJson(reply, 200, flag(data));
  };
}

/**
 * `getIsPublished`: published and holding the old publish ID, as the old API answered; a survey
 * published only through this API (or made in Studio) has none, and answers `false`.
 */
export const getIsPublished = surveyFlag(
  (survey) => survey.published && survey.legacyPublishId !== null,
);

/** `getIsResultPublic`: whether its results are public ("Grant Access"). */
export const getIsResultPublic = surveyFlag((survey) => survey.settings.publicResults === true);

/**
 * The survey whose old publish ID is `versionId` (only its current one), if the caller can see it;
 * the old API changed nothing more for `publishVersion` and `changeVersionTitle`.
 */
async function surveyByVersion(request: FastifyRequest): Promise<{
  versionId: string;
  survey: Survey | undefined;
}> {
  const versionId = await boundGuid(request, "versionId");
  const { data, response } = await studio(request).GET("/surveys", {
    params: { query: { legacyPublishId: versionId } },
  });
  if (data === undefined) return unexpectedStatus(response);
  return { versionId, survey: data.items[0] };
}

/**
 * `publishVersion`: the version ID back when the caller may change the survey; an unknown
 * version is an empty `400`, as the old API's.
 */
export async function publishVersion(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const { versionId, survey } = await surveyByVersion(request);
  if (survey === undefined) return sendEmpty(reply, 400);
  if (!survey.permissions.canModify) {
    return sendJsonString(
      reply,
      400,
      `You are not authorized to publish the survey version ${versionId}.`,
    );
  }
  return sendJsonString(reply, 200, versionId);
}

/** `changeVersionTitle`: `true` when the caller may change the survey; the title is not kept. */
export async function changeVersionTitle(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const { versionId, survey } = await surveyByVersion(request);
  if (survey === undefined || !survey.permissions.canModify) {
    return sendJsonString(
      reply,
      400,
      `You are not authorized to modify the survey version ${versionId}.`,
    );
  }
  return sendJson(reply, 200, true);
}

/**
 * `clone`: a copy named "Copy of …" beside its source (Studio's defaults), answered with an empty
 * `200`; the old API did not return the new ID either. `POST` names the source `surveyId`, `PUT`
 * names it `id`.
 */
function cloneAction(parameter: "surveyId" | "id"): RouteHandlerMethod {
  return async function clone(request, reply) {
    const id = await boundGuid(request, parameter);
    const { data, response } = await studio(request).POST("/surveys/{surveyId}/clones", {
      params: { path: { surveyId: id } },
      body: {},
    });
    if (data !== undefined) return sendEmpty(reply, 200);
    if (isRefusal(response.status)) return notAuthorized(reply, MODIFY, id);
    return unexpectedStatus(response);
  };
}

export const postClone = cloneAction("surveyId");
export const putClone = cloneAction("id");

/**
 * `changeOrganization` (ADR 0040 point 1): `organizationId` the caller's own ID moves the survey to
 * their Personal surveys, a project the caller may move it to moves it there; any other ID, and
 * any survey the caller may not move, get the old "Access denied" text.
 */
export async function changeOrganization(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const id = await boundGuid(request, "id");
  const organizationId = await boundGuid(request, "organizationId");
  // The key first, as the old API checked it before anything else.
  const me = (await callerId(client)).toLowerCase();
  if (organizationId === EMPTY_GUID) return sendText(reply, ACCESS_DENIED);
  const moved = await updateSurvey(client, id, {
    projectId: organizationId === me ? null : organizationId,
  });
  if (moved === "refused" || moved === "invalid") return sendText(reply, ACCESS_DENIED);
  return sendEmpty(reply, 200);
}
