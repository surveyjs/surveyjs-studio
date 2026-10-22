import type { Clock } from "../../auth/session.js";
import type { AccountNoticesSetting } from "../../config.js";
import type { User } from "../../domain/types.js";
import { demoAccountNotices, type AccountNotices } from "../../notices/account-notices.js";
import { licenceNotices } from "../../notices/licence-rule.js";
import type { UserDirectory } from "../../providers/types.js";
import { licenceExpiriesFromApi, userFromApi, usersFromLookup } from "./mapping.js";

export interface SurveyjsApiOptions {
  /** USER_API_URL without a trailing slash. */
  readonly baseUrl: string;
  /** USER_API_TOKEN. Secret: never in a message or log. */
  readonly token: string;
  /** `ACCOUNT_NOTICES`; `surveyjs-licenses` reads the API's licences, the others are the demo values. Default `none`. */
  readonly accountNotices?: AccountNoticesSetting;
  /** Clock of the licence rule; default `Date.now`. */
  readonly now?: Clock;
  /** Default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Per call; default 5000. */
  readonly timeoutMs?: number;
}

/** A failed call. The message names the operation and the status or reason only. */
export class UserApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
    reason: string,
  ) {
    super(`The surveyjs.io user API failed: ${operation} (${reason})`);
    this.name = "UserApiError";
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === "TimeoutError";

/**
 * Releases an answer's body that is not read, so its connection is not held until GC. Not
 * awaited: a cancel can wait on a reader that never comes (a tee'd body), and the call has its
 * answer already. A failed cancel means nothing is held.
 */
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/** A user id nobody has: the readiness probe looks it up and expects a 404. */
const PROBE_USER_ID = "00000000-0000-4000-8000-000000000000";

export function createSurveyjsApiDirectory(options: SurveyjsApiOptions): {
  readonly users: UserDirectory;
  readonly notices: AccountNotices;
  /** True when the API answers (a 404 for a user nobody has); false for anything else. */
  probe(): Promise<boolean>;
} {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? Date.now;
  const setting = options.accountNotices ?? "none";

  /** One call: the parsed JSON of a 200, null for a 404, else a UserApiError. */
  async function call(
    operation: string,
    path: string,
    body?: unknown,
  ): Promise<{ readonly json: unknown } | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.token}`,
      accept: "application/json",
    };
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers,
      // A redirect is a failure (a network error): the bearer token never goes to another address.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, init);
    } catch (error) {
      throw new UserApiError(operation, null, isTimeout(error) ? "timeout" : "network error");
    }
    if (response.status === 404) {
      discardBody(response);
      return null;
    }
    if (response.status !== 200) {
      discardBody(response);
      throw new UserApiError(operation, response.status, `status ${response.status}`);
    }
    try {
      return { json: (await response.json()) as unknown };
    } catch (error) {
      throw new UserApiError(operation, 200, isTimeout(error) ? "timeout" : "malformed answer");
    }
  }

  const malformed = (operation: string): UserApiError =>
    new UserApiError(operation, 200, "malformed answer");

  async function getUser(id: string): Promise<User | null> {
    if (!GUID.test(id)) return null;
    const operation = "user lookup";
    const lower = id.toLowerCase();
    const answer = await call(operation, `/users/${lower}`);
    if (answer === null) return null;
    const user = userFromApi(answer.json);
    if (user === null || user.id !== lower) throw malformed(operation);
    return user;
  }

  const users: UserDirectory = {
    kind: "external",
    getUser,
    async findUserByEmail(email) {
      if (email.trim() === "") return null;
      const operation = "user lookup by email";
      const answer = await call(operation, "/users/by-email", { email: email.toLowerCase() });
      if (answer === null) return null;
      const user = userFromApi(answer.json);
      if (user === null) throw malformed(operation);
      return user;
    },
    signInUser: (claims) => getUser(claims.sub),
    async missingUsers(ids) {
      const unique = [...new Set(ids.filter((id) => GUID.test(id)).map((id) => id.toLowerCase()))];
      const missing: string[] = [];
      for (let start = 0; start < unique.length; start += CHUNK) {
        const asked = unique.slice(start, start + CHUNK);
        const operation = "user batch lookup";
        const answer = await call(operation, "/users/lookup", { ids: asked });
        // A 404 is not an answer of this call: it is a failure, never "everyone is missing".
        if (answer === null) throw new UserApiError(operation, 404, "status 404");
        const found = usersFromLookup(answer.json);
        if (found === null) throw malformed(operation);
        const known = new Set(found.map((user) => user.id));
        missing.push(...asked.filter((id) => !known.has(id)));
      }
      return missing;
    },
  };

  const licenceNoticesFromApi: AccountNotices = {
    async noticesFor(userId) {
      if (!GUID.test(userId)) return [];
      const operation = "licence list";
      const answer = await call(operation, `/users/${userId.toLowerCase()}/licences`);
      if (answer === null) return [];
      const expiries = licenceExpiriesFromApi(answer.json);
      if (expiries === null) throw malformed(operation);
      return licenceNotices(expiries, now());
    },
  };
  const notices =
    setting === "surveyjs-licenses" ? licenceNoticesFromApi : demoAccountNotices(setting);

  async function probe(): Promise<boolean> {
    try {
      return (await call("readiness probe", `/users/${PROBE_USER_ID}`)) === null;
    } catch {
      return false;
    }
  }

  return { users, notices, probe };
}
