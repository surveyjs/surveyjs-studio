// The bridge's mapping table (ADR 0040 point 5): every old action the bridge answers itself, with
// its routes, its key rule and the Studio operations it calls. The router is built from it
// (actions/index.ts), and the migration guide's table is checked against it. A path or method the
// table does not hold is forwarded to the old service.
import type { HTTPMethods, onRequestAsyncHookHandler, RouteHandlerMethod } from "fastify";
import { generateAccessKey, setGenerationJSONType } from "./actions/account.js";
import { file, files, image } from "./actions/files.js";
import { MAX_POST_BYTES, post, upload, uploadGate } from "./actions/post.js";
import { getResult, getSurveyPublicResults } from "./actions/results.js";
import { getSurvey, getSurveyAndIsCompleted, isCompleted } from "./actions/survey.js";
import {
  archive,
  changeName,
  changeOrganization,
  changeVersionTitle,
  create,
  deleteSurvey,
  getActive,
  getArchive,
  getIsPublished,
  getIsResultPublic,
  getSurveyInfo,
  makeResultPublic,
  postClone,
  publish,
  publishVersion,
  putClone,
  restore,
  setUseCookies,
  storeIPAddressInResult,
  unPublish,
} from "./actions/surveys.js";
import { sendEmpty } from "./answers.js";
import type { KeyRule } from "./key.js";
import type { Controller } from "./routes.js";
import type { BridgeSettings } from "./settings.js";

export type { KeyRule } from "./key.js";

export interface ActionEntry {
  /** The old action's name, as its route has it. */
  action: string;
  controller: Controller;
  methods: HTTPMethods[];
  /**
   * Paths under each of the controller's prefixes, with a `/:id` form where the old route has one;
   * `""` is the prefix itself.
   */
  paths: string[];
  key: KeyRule;
  /** The contract operations (operationIds) the action calls. */
  studio: readonly string[];
  handler: RouteHandlerMethod;
  /** The largest body (bytes; default: the old host's limit), or the setting that gives it. */
  bodyLimit?: number | ((settings: BridgeSettings) => number);
  /** Runs before the body is read (e.g. to refuse a request without reading it). */
  onRequest?: onRequestAsyncHookHandler;
}

/** Every method the router knows: the bare root path answers them all alike. */
const ANY_METHOD: HTTPMethods[] = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

export const ACTIONS: readonly ActionEntry[] = [
  // Step 5: the public actions (ADR 0039).
  {
    action: "getSurvey",
    controller: "public",
    methods: ["GET"],
    paths: ["getSurvey"],
    key: "none",
    studio: ["getPublicDefinition"],
    handler: getSurvey,
  },
  {
    action: "getSurveyAndIsCompleted",
    controller: "public",
    methods: ["GET"],
    paths: ["getSurveyAndIsCompleted"],
    key: "none",
    studio: ["getRespondentState", "getPublicDefinition"],
    handler: getSurveyAndIsCompleted,
  },
  {
    action: "isCompleted",
    controller: "public",
    methods: ["GET"],
    paths: ["isCompleted"],
    key: "none",
    studio: ["getRespondentStateByResultId"],
    handler: isCompleted,
  },
  {
    action: "post",
    controller: "public",
    methods: ["POST"],
    paths: ["post"],
    key: "none",
    studio: ["submitResponseByPostId"],
    handler: post,
    bodyLimit: MAX_POST_BYTES,
  },
  {
    action: "upload",
    controller: "public",
    methods: ["POST"],
    paths: ["upload"],
    key: "none",
    studio: ["uploadResponseFileByPostId"],
    handler: upload,
    bodyLimit: (settings) => settings.maxUploadBytes,
    onRequest: uploadGate,
  },
  {
    action: "getResult",
    controller: "public",
    methods: ["GET"],
    paths: ["getResult"],
    key: "none",
    studio: ["getQuestionSummary"],
    handler: getResult,
  },
  {
    action: "getSurveyPublicResults",
    controller: "private",
    methods: ["GET"],
    paths: ["getSurveyPublicResults", "getSurveyPublicResults/:id"],
    key: "none",
    studio: ["getPublicResults"],
    handler: getSurveyPublicResults,
  },
  {
    action: "image",
    controller: "public",
    methods: ["GET"],
    paths: ["image"],
    key: "none",
    studio: ["downloadFile", "getLegacyFile"],
    handler: image,
  },
  {
    action: "file",
    controller: "public",
    methods: ["GET"],
    paths: ["file"],
    key: "none",
    studio: ["downloadFile", "getLegacyFile"],
    handler: file,
  },
  {
    action: "files",
    controller: "private",
    methods: ["GET"],
    paths: ["files"],
    key: "none",
    studio: ["getLegacyFile"],
    handler: files,
  },

  // Step 6: the access-key actions (ADR 0040).
  {
    action: "generateAccessKey",
    controller: "private",
    methods: ["GET"],
    paths: ["generateAccessKey"],
    key: "text",
    studio: ["replaceCurrentCredential"],
    handler: generateAccessKey,
  },
  {
    action: "setGenerationJSONType",
    controller: "private",
    methods: ["PUT"],
    paths: ["setGenerationJSONType"],
    key: "authorize",
    studio: ["getCurrentUser"],
    handler: setGenerationJSONType,
  },
  {
    action: "getSurveyInfo",
    controller: "private",
    methods: ["GET"],
    paths: ["getSurveyInfo"],
    key: "authorize",
    studio: ["getSurvey", "getSurveyTheme", "getSurveyDefinition", "getCurrentUser"],
    handler: getSurveyInfo,
  },
  {
    action: "getActive",
    controller: "private",
    methods: ["GET"],
    paths: ["getActive"],
    key: "authorize",
    studio: ["listSurveys", "getCurrentUser"],
    handler: getActive,
  },
  {
    action: "getArchive",
    controller: "private",
    methods: ["GET"],
    paths: ["getArchive"],
    key: "authorize",
    studio: ["listSurveys", "getCurrentUser"],
    handler: getArchive,
  },
  {
    action: "create",
    controller: "private",
    methods: ["POST"],
    paths: ["create"],
    key: "authorize",
    studio: ["createSurvey", "getCurrentUser"],
    handler: create,
  },
  {
    action: "archive",
    controller: "private",
    methods: ["PUT"],
    paths: ["archive", "archive/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: archive,
  },
  {
    action: "restore",
    controller: "private",
    methods: ["PUT"],
    paths: ["restore", "restore/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: restore,
  },
  {
    action: "delete",
    controller: "private",
    methods: ["DELETE"],
    paths: ["delete", "delete/:id"],
    key: "authorize",
    studio: ["deleteSurvey", "updateSurvey"],
    handler: deleteSurvey,
  },
  {
    action: "changeName",
    controller: "private",
    methods: ["PUT"],
    paths: ["changeName", "changeName/:id"],
    key: "authorize",
    studio: ["updateSurvey", "getSurvey"],
    handler: changeName,
  },
  {
    action: "getIsPublished",
    controller: "private",
    methods: ["GET"],
    paths: ["getIsPublished", "getIsPublished/:id"],
    key: "authorize",
    studio: ["getSurvey"],
    handler: getIsPublished,
  },
  {
    action: "publishVersion",
    controller: "private",
    methods: ["PUT"],
    paths: ["publishVersion"],
    key: "authorize",
    studio: ["listSurveys"],
    handler: publishVersion,
  },
  {
    action: "publish",
    controller: "private",
    methods: ["PUT"],
    paths: ["publish", "publish/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: publish,
  },
  {
    action: "unPublish",
    controller: "private",
    methods: ["PUT"],
    paths: ["unPublish", "unPublish/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: unPublish,
  },
  {
    action: "setUseCookies",
    controller: "private",
    methods: ["PUT"],
    paths: ["setUseCookies", "setUseCookies/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: setUseCookies,
  },
  {
    action: "changeVersionTitle",
    controller: "private",
    methods: ["PUT"],
    paths: ["changeVersionTitle"],
    key: "authorize",
    studio: ["listSurveys"],
    handler: changeVersionTitle,
  },
  {
    action: "getIsResultPublic",
    controller: "private",
    methods: ["GET"],
    paths: ["getIsResultPublic", "getIsResultPublic/:id"],
    key: "authorize",
    studio: ["getSurvey"],
    handler: getIsResultPublic,
  },
  {
    action: "makeResultPublic",
    controller: "private",
    methods: ["PUT"],
    paths: ["makeResultPublic", "makeResultPublic/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: makeResultPublic,
  },
  {
    action: "storeIPAddressInResult",
    controller: "private",
    methods: ["PUT"],
    paths: ["storeIPAddressInResult", "storeIPAddressInResult/:id"],
    key: "authorize",
    studio: ["updateSurvey"],
    handler: storeIPAddressInResult,
  },
  {
    action: "clone",
    controller: "private",
    methods: ["POST"],
    paths: ["clone"],
    key: "key-401",
    studio: ["cloneSurvey"],
    handler: postClone,
  },
  {
    action: "clone",
    controller: "private",
    methods: ["PUT"],
    paths: ["clone", "clone/:id"],
    key: "text",
    studio: ["cloneSurvey"],
    handler: putClone,
  },
  {
    action: "changeOrganization",
    controller: "private",
    methods: ["PUT"],
    paths: ["changeOrganization", "changeOrganization/:id"],
    key: "authorize",
    studio: ["getCurrentUser", "updateSurvey"],
    handler: changeOrganization,
  },
  {
    // The bare prefixes: the old routing found no single action there and failed for every
    // method; the bridge answers the same empty 500 without asking anyone (ADR 0040 point 1).
    action: "(root)",
    controller: "private",
    methods: ANY_METHOD,
    paths: [""],
    key: "none",
    studio: [],
    handler: async (_request, reply) => sendEmpty(reply, 500),
  },
];
