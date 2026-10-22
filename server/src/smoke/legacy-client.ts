/**
 * The reads `pnpm smoke:legacy` makes on `api.surveyjs.io` (legacy-data-layout section 7). Answers
 * use the member names of the legacy C# models (Newtonsoft `DefaultContractResolver`: `Id`, `Name`,
 * `IsPublished`, …).
 *
 * The access key is a secret: it goes into the query string of the private calls (the legacy API
 * reads `accessKey` only from there) and nowhere else. Errors carry the endpoint name and the HTTP
 * status or the error name only, never the URL or the answer: the legacy API echoes a wrong key in
 * its error text ("The accessKey '…' is incorrect.").
 */

export const DEFAULT_LEGACY_API = "https://api.surveyjs.io";

/** A failed legacy read. The message names the endpoint and a status or error name only. */
export class LegacyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyApiError";
  }
}

/** A survey as `getActive` lists it (`the site's code`); only the members read here. */
export interface LegacySurvey {
  readonly Id: string;
  readonly Name: string | null;
  /** The owner scope: the user id (personal) or the project id. */
  readonly UserId: string;
  /** `null` while the flag is empty (the old list then shows Publish). */
  readonly IsPublished: boolean | null;
  readonly IsArchived: boolean;
  readonly AllowAccessResult: boolean;
  /** The theme JSON as stored text. */
  readonly Theme: string | null;
  readonly PostId: string;
  readonly ResultId: string;
}

/** `{ Data, ResultCount }` of `getSurveyResults` and `getSurveyPublicResults`. */
export interface LegacyResults {
  readonly Data: readonly Record<string, unknown>[];
  readonly ResultCount: number;
}

/** `getResult`: how often each answer of one question was given. */
export interface LegacyQuestionResult {
  readonly AnswersCount: number;
  readonly QuestionResult: Readonly<Record<string, number>>;
  readonly ResultCount: number;
}

export interface LegacyClient {
  /**
   * `private/Surveys/getActive`: the active surveys of the key's account; with `ownerId`, those of
   * that project when the account is a member of it (else the account's own, as the legacy
   * `GetOwnerId` falls back).
   */
  listActive(ownerId?: string): Promise<LegacySurvey[]>;
  /** `public/Survey/getSurvey`: the definition; null when the API answers 400 (none stored). */
  getSurvey(surveyId: string): Promise<unknown>;
  /** `private/Surveys/getHistoryPoint`: the definition stored with that point. */
  getHistoryPoint(surveyId: string, pointId: string): Promise<unknown>;
  /** `private/Surveys/getSurveyResults/{id}`: every response, full access. */
  getSurveyResults(surveyId: string): Promise<LegacyResults>;
  /** `private/Surveys/getSurveyPublicResults/{id}`: the public results (no key). */
  getSurveyPublicResults(surveyId: string): Promise<LegacyResults>;
  /** `public/Survey/getResult`: the answer counts of one question. */
  getResult(resultId: string, name: string): Promise<LegacyQuestionResult>;
  /** `public/Survey/isCompleted`: `no`, `partial` or `completed`. */
  isCompleted(resultId: string, clientId: string): Promise<string>;
}

export interface LegacyClientOptions {
  /** `https://api.surveyjs.io`, or a stub's base URL in tests. */
  readonly baseUrl: string;
  /** Secret: sent as `accessKey` in the query of the private calls, never printed. */
  readonly accessKey: string;
  /** Default 30 seconds per request. */
  readonly timeoutMs?: number;
  /** Default the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const PUBLIC = "/public/Survey";
const PRIVATE = "/private/Surveys";

/** The error name and a plain code of the error or its cause: never a message. */
function failureName(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(error.name)) parts.push(error.name);
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) {
      parts.push(code);
      break;
    }
  }
  return parts.length > 0 ? parts.join(", ") : "unknown error";
}

export function createLegacyClient(options: LegacyClientOptions): LegacyClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const doFetch = options.fetch ?? fetch;

  /**
   * GETs `path` and parses the answer as JSON (or returns the text when `text` is set). 400 gives
   * null when `allow400` is set; any other non-2xx status is a LegacyApiError.
   */
  async function get(
    endpoint: string,
    path: string,
    params: Readonly<Record<string, string>>,
    flags: { readonly key?: boolean; readonly allow400?: boolean; readonly text?: boolean } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams(params);
    if (flags.key) query.set("accessKey", options.accessKey);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}?${query.toString()}`, {
        method: "GET",
        // A redirect would carry the key to another address.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new LegacyApiError(`${endpoint}: the request failed (${failureName(error)})`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new LegacyApiError(`${endpoint}: the answer could not be read (${failureName(error)})`);
    }
    if (response.status === 400 && flags.allow400) return null;
    if (!response.ok) throw new LegacyApiError(`${endpoint} answered HTTP ${response.status}`);
    if (flags.text) return text;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LegacyApiError(`${endpoint} answered with text that is not JSON`);
    }
  }

  function resultsOf(endpoint: string, value: unknown): LegacyResults {
    const data = (value as { Data?: unknown } | null)?.Data;
    if (!Array.isArray(data)) throw new LegacyApiError(`${endpoint} answered without a Data list`);
    return value as LegacyResults;
  }

  return {
    async listActive(ownerId) {
      const value = await get(
        "getActive",
        `${PRIVATE}/getActive`,
        ownerId === undefined ? {} : { ownerId },
        { key: true },
      );
      if (!Array.isArray(value)) throw new LegacyApiError("getActive answered without a list");
      return value as LegacySurvey[];
    },

    getSurvey(surveyId) {
      return get("getSurvey", `${PUBLIC}/getSurvey`, { surveyId }, { allow400: true });
    },

    getHistoryPoint(surveyId, pointId) {
      return get(
        "getHistoryPoint",
        `${PRIVATE}/getHistoryPoint`,
        { id: surveyId, pointId },
        { key: true },
      );
    },

    async getSurveyResults(surveyId) {
      const path = `${PRIVATE}/getSurveyResults/${encodeURIComponent(surveyId)}`;
      return resultsOf("getSurveyResults", await get("getSurveyResults", path, {}, { key: true }));
    },

    async getSurveyPublicResults(surveyId) {
      const path = `${PRIVATE}/getSurveyPublicResults/${encodeURIComponent(surveyId)}`;
      return resultsOf("getSurveyPublicResults", await get("getSurveyPublicResults", path, {}));
    },

    async getResult(resultId, name) {
      const value = await get("getResult", `${PUBLIC}/getResult`, { resultId, name });
      const counts = (value as { QuestionResult?: unknown } | null)?.QuestionResult;
      if (counts === null || typeof counts !== "object") {
        throw new LegacyApiError("getResult answered without QuestionResult");
      }
      return value as LegacyQuestionResult;
    },

    async isCompleted(resultId, clientId) {
      const text = String(
        await get("isCompleted", `${PUBLIC}/isCompleted`, { resultId, clientId }, { text: true }),
      ).trim();
      // ASP.NET answers a string as text/plain, or as a JSON string when JSON is negotiated.
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === "string") return parsed;
      } catch {
        // Plain text.
      }
      return text;
    },
  };
}
