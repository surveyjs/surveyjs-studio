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
 * One call to `/api/v1<path>`. Fails unless the status is `expected`; returns the parsed JSON body
 * (or null when there is none).
 * @param {string} baseUrl
 * @param {Session | null} session
 * @param {string} method
 * @param {string} path
 * @param {number} expected
 * @param {{ body?: unknown, contentType?: string }} [options]
 * @returns {Promise<any>}
 */
async function call(baseUrl, session, method, path, expected, options = {}) {
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json", ...(session?.headers() ?? {}) };
  if (options.body !== undefined)
    headers["content-type"] = options.contentType ?? "application/json";
  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new FlowError(`${method} ${path}: ${describeError(error)}`);
  }
  session?.store(response);
  const text = await response.text();
  if (response.status !== expected) {
    throw new FlowError(
      `${method} ${path} answered ${response.status}${problemCode(text)}, not ${expected}`,
    );
  }
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
  "Usage: node flow.mjs <baseUrl> bootstrap-and-create | verify <surveyId> | wait-ready [seconds]";

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
