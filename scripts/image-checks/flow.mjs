// The image checks' user flow (`pnpm image:checks`), over the contract's operations only
// (contract/openapi.yaml), with the session cookie and the CSRF header. Dependency-free: it runs
// on the host (`node flow.mjs <baseUrl> <command>`) and inside a container of the image itself:
//   docker run -i --rm --network <net> --entrypoint node <image> --input-type=module - <baseUrl> <command> < flow.mjs
//
// Commands:
//   bootstrap-and-create  signs the first admin in with ADMIN_EMAIL and ADMIN_PASSWORD, makes the
//                         forced password change to FLOW_NEW_PASSWORD, creates a survey with one
//                         question, publishes it, submits one response and reads it back from the
//                         results. Prints {"surveyId": "...", "resultId": "..."} (resultId: the
//                         stored response's id).
//   verify <surveyId>     signs in with ADMIN_EMAIL and FLOW_NEW_PASSWORD, checks the survey, that
//                         it runs, and its one response. Prints the same JSON.
//   create-wide           after bootstrap-and-create: a second user (active), a project with that
//                         member and a pending invitation, a project survey with an asset, two
//                         definition saves (history), a theme, public results with a private
//                         question, two responses (one with a respondent's file), a saved table
//                         view, an archived survey and a clone. Prints the ids and ETags as JSON.
//   verify-wide <json>    checks everything create-wide stored (its JSON), the ETags and the
//                         files' bytes included. Prints {"surveyId": "...", "checked": "wide"}.
//   wait-ready [seconds]  waits (default 60 s) until /healthz and /readyz answer 200. Prints
//                         {"healthz": 200, "readyz": 200}.
//
// Exit codes: 0 done, 1 a step failed (the reason on stderr), 2 usage error. The passwords come
// from the environment and are never printed.

const SURVEY_NAME = "Image check survey";
const QUESTION = "answer";
const ANSWER = "Stored by the image checks";
const CLIENT_ID = "image-checks";
const REQUEST_TIMEOUT_MS = 15_000;

class FlowError extends Error {}

/** @param {string} name */
function setting(name) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new FlowError(`${name} is not set`);
  return value;
}

/** Cookies of one browser: names and values only. */
class Session {
  /** @type {Map<string, string>} */
  cookies = new Map();

  /** @param {Response} response */
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const removed = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (removed) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(at + 1).trim());
    }
  }

  /** @returns {Record<string, string>} */
  headers() {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    /** @type {Record<string, string>} */
    const headers = cookie === "" ? {} : { cookie };
    const csrf = this.cookies.get("msid_csrf");
    if (csrf !== undefined) headers["x-csrf-token"] = csrf;
    return headers;
  }
}

/**
 * @typedef {{ body?: unknown, contentType?: string, form?: FormData, headers?: Record<string, string> }} CallOptions
 * `body` goes as JSON (or `contentType`); `form` as multipart/form-data.
 */

/**
 * One request to `/api/v1<path>`. Fails unless the status is `expected`; returns the headers and
 * the raw body.
 * @param {string} baseUrl
 * @param {Session | null} session
 * @param {string} method
 * @param {string} path
 * @param {number} expected
 * @param {CallOptions} [options]
 * @returns {Promise<{ headers: Headers, bytes: Buffer }>}
 */
async function request(baseUrl, session, method, path, expected, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/json",
    ...(session?.headers() ?? {}),
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined)
    headers["content-type"] = options.contentType ?? "application/json";
  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new FlowError(`${method} ${path}: ${describeError(error)}`);
  }
  session?.store(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== expected) {
    throw new FlowError(
      `${method} ${path} answered ${response.status}${problemCode(bytes.toString("utf8"))}, not ${expected}`,
    );
  }
  return { headers: response.headers, bytes };
}

/**
 * One call to `/api/v1<path>`. Fails unless the status is `expected`; returns the parsed JSON body
 * (or null when there is none).
 * @param {string} baseUrl
 * @param {Session | null} session
 * @param {string} method
 * @param {string} path
 * @param {number} expected
 * @param {CallOptions} [options]
 * @returns {Promise<any>}
 */
async function call(baseUrl, session, method, path, expected, options = {}) {
  const { bytes } = await request(baseUrl, session, method, path, expected, options);
  const text = bytes.toString("utf8");
  return text === "" ? null : JSON.parse(text);
}

/** ` (code)` of a Problem Details body, or nothing. @param {string} text */
function problemCode(text) {
  try {
    const code = JSON.parse(text)?.code;
    return typeof code === "string" ? ` (${code})` : "";
  } catch {
    return "";
  }
}

/** @param {unknown} error */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

/**
 * @param {boolean} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function check(condition, message) {
  if (!condition) throw new FlowError(message);
}

/**
 * Signs in with the password; returns the session.
 * @param {string} baseUrl
 * @param {string} email
 * @param {string} password
 */
async function signIn(baseUrl, email, password) {
  const session = new Session();
  await call(baseUrl, session, "POST", "/auth/password/login", 204, { body: { email, password } });
  check(session.cookies.has("msid"), "the sign-in set no session cookie");
  return session;
}

/**
 * The survey's one response, with the flow's answer.
 * @param {string} baseUrl
 * @param {Session} session
 * @param {string} surveyId
 * @returns {Promise<string>} the response's id
 */
async function theOneResponse(baseUrl, session, surveyId) {
  const page = await call(baseUrl, session, "GET", `/surveys/${surveyId}/results`, 200);
  const items = Array.isArray(page?.items) ? page.items : [];
  check(items.length === 1, `the survey has ${items.length} responses, not 1`);
  check(items[0].data?.[QUESTION] === ANSWER, "the response does not hold the answer sent");
  check(typeof items[0].id === "string", "the response has no id");
  return items[0].id;
}

/** @param {string} baseUrl */
async function bootstrapAndCreate(baseUrl) {
  const email = setting("ADMIN_EMAIL");
  const password = setting("ADMIN_PASSWORD");
  const newPassword = setting("FLOW_NEW_PASSWORD");

  const session = await signIn(baseUrl, email, password);
  const me = await call(baseUrl, session, "GET", "/me", 200);
  check(me?.mustChangePassword === true, "the first admin was not asked to change the password");
  await call(baseUrl, session, "POST", "/me/password", 204, {
    body: { currentPassword: password, newPassword },
  });
  const changed = await call(baseUrl, session, "GET", "/me", 200);
  check(changed?.mustChangePassword === false, "the password change did not end the forced change");

  const survey = await call(baseUrl, session, "POST", "/surveys", 201, {
    body: {
      name: SURVEY_NAME,
      definition: { pages: [{ name: "page1", elements: [{ type: "text", name: QUESTION }] }] },
    },
  });
  const surveyId = survey?.id;
  check(typeof surveyId === "string", "createSurvey returned no id");
  const published = await call(baseUrl, session, "PATCH", `/surveys/${surveyId}`, 200, {
    body: { published: true },
    contentType: "application/merge-patch+json",
  });
  check(published?.published === true, "the survey is not published");

  const stored = await call(baseUrl, null, "POST", `/public/surveys/${surveyId}/responses`, 201, {
    body: { data: { [QUESTION]: ANSWER }, clientId: CLIENT_ID },
  });
  const resultId = await theOneResponse(baseUrl, session, surveyId);
  check(stored?.id === resultId, "the results list another response than the one stored");
  return { surveyId, resultId };
}

/**
 * @param {string} baseUrl
 * @param {string} surveyId
 */
async function verify(baseUrl, surveyId) {
  const session = await signIn(baseUrl, setting("ADMIN_EMAIL"), setting("FLOW_NEW_PASSWORD"));
  const me = await call(baseUrl, session, "GET", "/me", 200);
  check(me?.mustChangePassword === false, "the admin must change the password again");
  const id = encodeURIComponent(surveyId);
  const survey = await call(baseUrl, session, "GET", `/surveys/${id}`, 200);
  check(survey?.name === SURVEY_NAME, "the survey's name changed");
  check(survey?.published === true, "the survey is no longer published");
  const definition = await call(baseUrl, session, "GET", `/surveys/${id}/definition`, 200);
  const elements = definition?.pages?.[0]?.elements ?? [];
  check(elements[0]?.name === QUESTION, "the survey lost its question");
  await call(baseUrl, null, "GET", `/public/surveys/${id}`, 200);
  const resultId = await theOneResponse(baseUrl, session, id);
  return { surveyId, resultId };
}

// The wide data set (create-wide / verify-wide): one of each kind of stored thing, so that the
// upgrade check covers every table a migration can touch. It uses only operations an earlier
// release already has: the previous release runs create-wide, the image under test verify-wide.
const MEMBER_EMAIL = "image-check-member@example.com";
const MEMBER_NAME = "Image Check Member";
const PENDING_EMAIL = "image-check-pending@example.com";
const PROJECT_NAME = "Image check project";
const WIDE_SURVEY_NAME = "Image check wide survey";
const ARCHIVED_NAME = "Image check archived survey";
const CLONE_NAME = "Image check clone";
const SECRET = "secret";
/** A 1×1 PNG: an asset must be an image or a video. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const RESPONDENT_FILE = Buffer.from("A respondent's file, stored by the image checks\n", "utf8");
const TABLE_VIEW = { columns: [{ name: "open", visible: true }], pageSize: 25 };
const RESPONSES = [
  { open: "first", [SECRET]: "hidden one" },
  { open: "second", [SECRET]: "hidden two" },
];

/** @param {string} assetUrl */
const wideDefinition = (assetUrl) => ({
  logo: assetUrl,
  pages: [
    {
      name: "page1",
      elements: [
        { type: "image", name: "picture", imageLink: assetUrl },
        { type: "text", name: "open" },
        { type: "text", name: SECRET },
        { type: "file", name: "upload", storeDataAsText: false },
      ],
    },
  ],
});

/** @param {string} assetUrl */
const wideTheme = (assetUrl) => ({
  themeName: "image-checks",
  backgroundImage: assetUrl,
  cssVariables: { "--sjs-primary-backcolor": "rgba(25, 179, 148, 1)" },
});

/**
 * JSON with sorted keys, to compare values whatever order the store keeps keys in.
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} what
 */
function checkEqual(actual, expected, what) {
  check(canonical(actual) === canonical(expected), `${what} changed`);
}

/** @param {Buffer} bytes */
const sha256 = async (bytes) =>
  (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");

/**
 * Uploads one file in the part `file`; returns the StoredFile.
 * @param {string} baseUrl
 * @param {Session | null} session
 * @param {string} path
 * @param {Buffer} bytes
 * @param {string} name
 * @param {string} type
 */
async function upload(baseUrl, session, path, bytes, name, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  const stored = await call(baseUrl, session, "POST", path, 201, { form });
  check(typeof stored?.id === "string" && typeof stored?.url === "string", `${path}: no file id`);
  return stored;
}

/**
 * A stored file's bytes, by its id (the stored URL names PUBLIC_BASE_URL, not this address).
 * @param {string} baseUrl
 * @param {string} fileId
 */
async function download(baseUrl, fileId) {
  const { bytes } = await request(
    baseUrl,
    null,
    "GET",
    `/public/files/${encodeURIComponent(fileId)}`,
    200,
    { headers: { accept: "*/*" } },
  );
  return bytes;
}

/**
 * A document's ETag.
 * @param {string} baseUrl
 * @param {Session} session
 * @param {string} path
 */
async function etagOf(baseUrl, session, path) {
  const { headers } = await request(baseUrl, session, "GET", path, 200);
  const etag = headers.get("etag");
  check(etag !== null && etag !== "", `GET ${path} sent no ETag`);
  return etag;
}

/**
 * Saves a document with If-Match; returns its new ETag.
 * @param {string} baseUrl
 * @param {Session} session
 * @param {string} path
 * @param {unknown} body
 */
async function saveDocument(baseUrl, session, path, body) {
  const ifMatch = await etagOf(baseUrl, session, path);
  const { headers } = await request(baseUrl, session, "PUT", path, 204, {
    body,
    headers: { "if-match": ifMatch },
  });
  const etag = headers.get("etag");
  check(etag !== null && etag !== ifMatch, `PUT ${path} sent no new ETag`);
  return etag;
}

/**
 * Every item of a paged list (`items`, `nextCursor`).
 * @param {string} baseUrl
 * @param {Session | null} session
 * @param {string} path
 * @returns {Promise<any[]>}
 */
async function allItems(baseUrl, session, path) {
  const items = [];
  let cursor = null;
  for (let pages = 0; pages < 50; pages++) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await call(
      baseUrl,
      session,
      "GET",
      cursor === null ? path : `${path}${separator}cursor=${encodeURIComponent(cursor)}`,
      200,
    );
    items.push(...(Array.isArray(page?.items) ? page.items : []));
    cursor = page?.nextCursor ?? null;
    if (cursor === null) return items;
  }
  throw new FlowError(`GET ${path}: more than 50 pages`);
}

/**
 * After bootstrap-and-create: the wide data set. Returns what verify-wide needs.
 * @param {string} baseUrl
 */
async function createWide(baseUrl) {
  const password = setting("FLOW_NEW_PASSWORD");
  const admin = await signIn(baseUrl, setting("ADMIN_EMAIL"), password);

  // A second user, active through their set-password link.
  const created = await call(baseUrl, admin, "POST", "/admin/users", 201, {
    body: { email: MEMBER_EMAIL, displayName: MEMBER_NAME },
  });
  const token = URL.canParse(created?.link?.url ?? "")
    ? new URL(created.link.url).searchParams.get("token")
    : null;
  check(typeof token === "string" && token !== "", "createUser returned no set-password link");
  await call(baseUrl, new Session(), "POST", "/auth/password-link", 204, {
    body: { token, password },
  });
  const member = await signIn(baseUrl, MEMBER_EMAIL, password);
  const memberId = (await call(baseUrl, member, "GET", "/me", 200))?.id;
  check(typeof memberId === "string", "the second user has no id");

  // A project with that user and a pending invitation.
  const project = await call(baseUrl, admin, "POST", "/projects", 201, {
    body: { name: PROJECT_NAME },
  });
  const projectId = project?.id;
  check(typeof projectId === "string", "createProject returned no id");
  const members = `/projects/${encodeURIComponent(projectId)}/members`;
  await call(baseUrl, admin, "POST", members, 201, { body: { email: MEMBER_EMAIL, role: "user" } });
  const pending = await call(baseUrl, admin, "POST", members, 201, {
    body: { email: PENDING_EMAIL, role: "user" },
  });
  check(pending?.status === "pending", "the invitation is not pending");

  // A project survey with an asset, a saved definition (history), a theme and settings.
  const survey = await call(baseUrl, admin, "POST", "/surveys", 201, {
    body: { name: WIDE_SURVEY_NAME, projectId },
  });
  const surveyId = survey?.id;
  check(typeof surveyId === "string", "createSurvey returned no id");
  const path = `/surveys/${encodeURIComponent(surveyId)}`;
  const asset = await upload(baseUrl, admin, `${path}/assets`, PNG, "logo.png", "image/png");
  await saveDocument(baseUrl, admin, `${path}/definition`, { pages: [{ name: "page1" }] });
  const definitionEtag = await saveDocument(
    baseUrl,
    admin,
    `${path}/definition`,
    wideDefinition(asset.url),
  );
  const themeEtag = await saveDocument(baseUrl, admin, `${path}/theme`, wideTheme(asset.url));
  await call(baseUrl, admin, "PATCH", path, 200, {
    body: { published: true, settings: { publicResults: true, privateResultQuestions: [SECRET] } },
    contentType: "application/merge-patch+json",
  });

  // Two responses, one with a respondent's file; a saved table view.
  const file = await upload(
    baseUrl,
    null,
    `/public/surveys/${encodeURIComponent(surveyId)}/files`,
    RESPONDENT_FILE,
    "notes.txt",
    "text/plain",
  );
  const [first = {}, second = {}] = RESPONSES;
  await call(
    baseUrl,
    null,
    "POST",
    `/public/surveys/${encodeURIComponent(surveyId)}/responses`,
    201,
    {
      body: {
        data: { ...first, upload: [{ name: "notes.txt", type: "text/plain", content: file.url }] },
      },
    },
  );
  await call(
    baseUrl,
    null,
    "POST",
    `/public/surveys/${encodeURIComponent(surveyId)}/responses`,
    201,
    {
      body: { data: second },
    },
  );
  await call(baseUrl, admin, "PUT", `${path}/views/table`, 204, { body: TABLE_VIEW });

  // An archived survey and a clone (which copies the asset under a new id).
  const archived = await call(baseUrl, admin, "POST", "/surveys", 201, {
    body: { name: ARCHIVED_NAME },
  });
  await call(baseUrl, admin, "PATCH", `/surveys/${encodeURIComponent(archived.id)}`, 200, {
    body: { archived: true },
    contentType: "application/merge-patch+json",
  });
  const clone = await call(baseUrl, admin, "POST", `${path}/clones`, 201, {
    body: { name: CLONE_NAME },
  });
  check(typeof clone?.id === "string", "cloneSurvey returned no id");

  const history = await allItems(baseUrl, admin, `${path}/history`);
  check(history.length >= 2, `the survey has ${history.length} history entries, not 2 or more`);
  return {
    surveyId,
    projectId,
    memberId,
    archivedId: archived.id,
    cloneId: clone.id,
    assetId: asset.id,
    assetUrl: asset.url,
    fileId: file.id,
    fileUrl: file.url,
    definitionEtag,
    themeEtag,
    historyIds: history.map((entry) => entry.id),
  };
}

/**
 * After an upgrade (or a restore): everything createWide stored, unchanged.
 * @param {string} baseUrl
 * @param {Record<string, any>} state createWide's output
 */
async function verifyWide(baseUrl, state) {
  const password = setting("FLOW_NEW_PASSWORD");
  const admin = await signIn(baseUrl, setting("ADMIN_EMAIL"), password);

  const users = await allItems(baseUrl, admin, "/admin/users");
  const user = users.find((item) => item.email === MEMBER_EMAIL);
  check(user?.status === "active", "the second user is not an active user any more");
  check(user?.id === state.memberId, "the second user's id changed");
  const member = await signIn(baseUrl, MEMBER_EMAIL, password);
  check((await call(baseUrl, member, "GET", "/me", 200))?.id === state.memberId, "/me changed");

  const projects = await allItems(baseUrl, admin, "/projects");
  check(
    projects.some((item) => item.id === state.projectId && item.name === PROJECT_NAME),
    "the project is gone or renamed",
  );
  const members = await allItems(
    baseUrl,
    admin,
    `/projects/${encodeURIComponent(state.projectId)}/members`,
  );
  check(
    members.some((item) => item.userId === state.memberId && item.role === "user"),
    "the project lost its member",
  );
  check(
    members.some(
      (item) => item.email === PENDING_EMAIL && item.status === "pending" && item.userId === null,
    ),
    "the project lost its pending invitation",
  );

  const path = `/surveys/${encodeURIComponent(state.surveyId)}`;
  const survey = await call(baseUrl, admin, "GET", path, 200);
  check(survey?.name === WIDE_SURVEY_NAME, "the wide survey's name changed");
  check(survey?.projectId === state.projectId, "the wide survey left its project");
  check(survey?.published === true, "the wide survey is no longer published");
  check(survey?.settings?.publicResults === true, "the wide survey's public results are off");
  checkEqual(
    survey?.settings?.privateResultQuestions,
    [SECRET],
    "the wide survey's private questions",
  );

  const definition = await call(baseUrl, admin, "GET", `${path}/definition`, 200);
  checkEqual(definition, wideDefinition(state.assetUrl), "the wide survey's definition");
  check(
    (await etagOf(baseUrl, admin, `${path}/definition`)) === state.definitionEtag,
    "the definition's ETag changed: an editor open across the upgrade would conflict",
  );
  checkEqual(
    await call(baseUrl, admin, "GET", `${path}/theme`, 200),
    wideTheme(state.assetUrl),
    "the wide survey's theme",
  );
  check(
    (await etagOf(baseUrl, admin, `${path}/theme`)) === state.themeEtag,
    "the theme's ETag changed",
  );

  const history = await allItems(baseUrl, admin, `${path}/history`);
  checkEqual(
    history.map((entry) => entry.id),
    state.historyIds,
    "the wide survey's history",
  );
  checkEqual(
    await call(
      baseUrl,
      admin,
      "GET",
      `${path}/history/${encodeURIComponent(state.historyIds[0])}`,
      200,
    ),
    definition,
    "the newest history entry",
  );

  check(
    (await sha256(await download(baseUrl, state.assetId))) === (await sha256(PNG)),
    "the asset's bytes changed",
  );
  check(
    (await sha256(await download(baseUrl, state.fileId))) === (await sha256(RESPONDENT_FILE)),
    "the respondent's file's bytes changed",
  );

  const results = await allItems(baseUrl, admin, `${path}/results`);
  check(results.length === 2, `the wide survey has ${results.length} responses, not 2`);
  const [first = {}, second = {}] = RESPONSES;
  const withFile = results.find((item) => item.data?.open === "first");
  checkEqual(
    withFile?.data,
    { ...first, upload: [{ name: "notes.txt", type: "text/plain", content: state.fileUrl }] },
    "the response with a file",
  );
  checkEqual(
    results.find((item) => item.data?.open === "second")?.data,
    second,
    "the second response",
  );
  const publicResults = await allItems(
    baseUrl,
    null,
    `/public/surveys/${encodeURIComponent(state.surveyId)}/results`,
  );
  check(publicResults.length === 2, `the public results list ${publicResults.length}, not 2`);
  check(
    publicResults.every((item) => item.data?.[SECRET] === undefined),
    "the public results show a private question's answer",
  );
  checkEqual(
    await call(baseUrl, admin, "GET", `${path}/views/table`, 200),
    TABLE_VIEW,
    "the saved table view",
  );

  const archived = await allItems(baseUrl, admin, "/surveys?archived=true");
  check(
    archived.some((item) => item.id === state.archivedId && item.name === ARCHIVED_NAME),
    "the archived survey is not archived any more",
  );
  const clone = await call(
    baseUrl,
    admin,
    "GET",
    `/surveys/${encodeURIComponent(state.cloneId)}`,
    200,
  );
  check(clone?.name === CLONE_NAME, "the clone's name changed");
  const cloned = await call(
    baseUrl,
    admin,
    "GET",
    `/surveys/${encodeURIComponent(state.cloneId)}/definition`,
    200,
  );
  const clonedUrl = cloned?.pages?.[0]?.elements?.[0]?.imageLink;
  check(
    typeof clonedUrl === "string" && clonedUrl !== state.assetUrl,
    "the clone has no own asset",
  );
  const clonedId = decodeURIComponent(new URL(clonedUrl).pathname.split("/").pop() ?? "");
  check(
    (await sha256(await download(baseUrl, clonedId))) === (await sha256(PNG)),
    "the clone's asset's bytes changed",
  );
  return { surveyId: state.surveyId, checked: "wide" };
}

/**
 * @param {string} baseUrl
 * @param {number} seconds
 */
async function waitReady(baseUrl, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const healthz = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
      const readyz = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(5000) });
      if (healthz.status === 200 && readyz.status === 200) {
        return { healthz: healthz.status, readyz: readyz.status };
      }
      last = `/healthz ${healthz.status}, /readyz ${readyz.status}`;
    } catch (error) {
      last = describeError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new FlowError(`/healthz and /readyz did not both answer 200 within ${seconds} s (${last})`);
}

const USAGE =
  "Usage: node flow.mjs <baseUrl> bootstrap-and-create | verify <surveyId> | create-wide | verify-wide <json> | wait-ready [seconds]";

/** @param {string[]} args */
async function main(args) {
  const [baseUrl = "", command, ...rest] = args;
  if (!URL.canParse(baseUrl)) return usage(`not a base URL: "${baseUrl}"`);
  const base = baseUrl.replace(/\/+$/, "");
  /** @type {object} */
  let result;
  if (command === "bootstrap-and-create" && rest.length === 0) {
    result = await bootstrapAndCreate(base);
  } else if (command === "verify" && rest.length === 1 && rest[0] !== "") {
    result = await verify(base, rest[0] ?? "");
  } else if (command === "create-wide" && rest.length === 0) {
    result = await createWide(base);
  } else if (command === "verify-wide" && rest.length === 1) {
    /** @type {unknown} */
    let state;
    try {
      state = JSON.parse(rest[0] ?? "");
    } catch {
      return usage("verify-wide needs create-wide's JSON");
    }
    if (typeof state !== "object" || state === null) {
      return usage("verify-wide needs create-wide's JSON");
    }
    result = await verifyWide(base, /** @type {Record<string, any>} */ (state));
  } else if (command === "wait-ready" && rest.length <= 1) {
    const seconds = Number(rest[0] ?? "60");
    if (!Number.isInteger(seconds) || seconds < 1) return usage("seconds must be a whole number");
    result = await waitReady(base, seconds);
  } else {
    return usage(command === undefined ? "no command" : `unknown command or arguments: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

/** @param {string} message */
function usage(message) {
  process.stderr.write(`flow: ${message}\n${USAGE}\n`);
  return 2;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `flow: ${error instanceof FlowError ? error.message : describeError(error)}\n`,
  );
  process.exitCode = 1;
}
