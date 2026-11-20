// Studio's own API, as the survey owner: the suite creates the surveys its state-changing cases
// run on and reads back what the bridge stored. Signs in over HTTP as a browser would, through the
// OAuth stub's form (memory), the mock OIDC server's login form (Azurite) or the dev provider's
// "Sign in as…" page (a server started with it).
import { inject } from "vitest";
import { FEEDBACK_DEFINITION, SETUP_SURVEY_NAME, type LayoutKind } from "./golden.js";

/** Studio's API base URL, with `/api/v1`. */
const STUDIO_URL = inject("studioUrl");

/** The fixtures' survey owner (server/fixtures/legacy). */
export const OWNER_ID = "11111111-0000-4000-8000-a00000000001";

const DEV_SIGN_IN_PATH = "/__dev/sign-in";

class CookieJar {
  private readonly values = new Map<string, string>();

  store(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      if (attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) {
        this.values.delete(name);
      } else {
        this.values.set(name, pair.slice(at + 1).trim());
      }
    }
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity] ?? entity);
}

/**
 * The callback URL: the dev page's link for the user, or the OAuth stub's or the mock OIDC
 * server's form posted as the user.
 */
async function authorize(location: URL, userId: string): Promise<URL> {
  const page = await fetch(location, { redirect: "manual" });
  if (page.status !== 200) throw new Error(`the sign-in page answered ${page.status}`);
  const html = await page.text();
  if (/<input\b[^>]*\bname="sub"/i.test(html)) {
    // The OAuth stub (server/src/testing/oauth-stub.ts): its form posts the authorize parameters
    // back with the subject, which is the fixture user's ID.
    const form = new URLSearchParams(location.searchParams);
    form.set("sub", userId);
    form.set("allow", "1");
    const login = await fetch(new URL(location.pathname, location), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const callback = login.headers.get("location");
    if (login.status !== 302 || callback === null) {
      throw new Error(`the OAuth stub's form answered ${login.status}`);
    }
    return new URL(callback);
  }
  if (location.pathname === DEV_SIGN_IN_PATH) {
    const choice = [...html.matchAll(/href="([^"]*)"/g)]
      .map((match) => new URL(decodeEntities(match[1] ?? ""), location))
      .find((link) => link.searchParams.get("code")?.toLowerCase() === userId.toLowerCase());
    if (!choice) throw new Error(`${DEV_SIGN_IN_PATH} does not list user ${userId}`);
    return choice;
  }
  const form = /<form\b[^>]*\bmethod="post"[^>]*>/i.exec(html)?.[0];
  if (!form || !/<input\b[^>]*\bname="username"/i.test(html)) {
    throw new Error(`cannot sign in through ${location.origin}${location.pathname}`);
  }
  const action = /\baction="([^"]*)"/i.exec(form)?.[1];
  const target = action ? new URL(decodeEntities(action), location) : location;
  const login = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: userId }).toString(),
  });
  const callback = login.headers.get("location");
  if (login.status !== 302 || callback === null) {
    throw new Error(`the mock OIDC login form answered ${login.status}`);
  }
  return new URL(callback, target);
}

let ownerSession: Promise<Record<string, string>> | undefined;

/** Request headers of the owner's browser session (cookie and CSRF token); signs in once per file. */
export function ownerHeaders(): Promise<Record<string, string>> {
  ownerSession ??= (async () => {
    const jar = new CookieJar();
    const login = await fetch(`${STUDIO_URL}/auth/login?returnTo=%2F`, { redirect: "manual" });
    jar.store(login);
    const location = login.headers.get("location");
    if (login.status !== 302 || location === null) {
      throw new Error(`login answered ${login.status}`);
    }
    const callback = await fetch(await authorize(new URL(location, STUDIO_URL), OWNER_ID), {
      redirect: "manual",
      headers: { cookie: jar.header() },
    });
    jar.store(callback);
    if (callback.status !== 302)
      throw new Error(`the sign-in callback answered ${callback.status}`);
    return { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
  })();
  return ownerSession;
}

/** Calls Studio's API as the owner; a JSON body is sent with its media type. */
export async function studio(
  method: string,
  path: string,
  body?: unknown,
  contentType = "application/json",
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${STUDIO_URL}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(await ownerHeaders()),
      ...(body !== undefined && { "content-type": contentType }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

export interface FreshSurvey {
  readonly surveyId: string;
  readonly postId: string;
  readonly resultId: string;
}

export { FEEDBACK_DEFINITION };

/**
 * Creates a survey as the owner with the feedback definition, and with `settings` (publicResults,
 * storeRespondentIp, privateResultQuestions) when given; in the project `projectId` when given.
 * Remove it with `removeSurvey`.
 */
export async function createSurvey(
  settings?: Record<string, unknown>,
  definition: unknown = FEEDBACK_DEFINITION,
  projectId?: string,
): Promise<FreshSurvey> {
  const created = await studio("POST", "/surveys", {
    name: SETUP_SURVEY_NAME,
    definition,
    ...(projectId !== undefined && { projectId }),
  });
  if (created.status !== 201) throw new Error(`createSurvey answered ${created.status}`);
  const survey = (await created.json()) as { id: string; postId: string; resultId: string };
  if (settings !== undefined) {
    const patched = await studio(
      "PATCH",
      `/surveys/${survey.id}`,
      { settings },
      "application/merge-patch+json",
    );
    if (patched.status !== 200) {
      await removeSurvey(survey.id);
      throw new Error(`updateSurvey answered ${patched.status}`);
    }
  }
  return { surveyId: survey.id, postId: survey.postId, resultId: survey.resultId };
}

/** Archives and deletes a survey the suite created; one already gone is fine. */
export async function removeSurvey(surveyId: string): Promise<void> {
  const archived = await studio(
    "PATCH",
    `/surveys/${surveyId}`,
    { archived: true },
    "application/merge-patch+json",
  );
  if (archived.status === 404) return;
  if (archived.status !== 200) throw new Error(`archiving answered ${archived.status}`);
  const deleted = await studio("DELETE", `/surveys/${surveyId}`);
  if (deleted.status !== 204 && deleted.status !== 404) {
    throw new Error(`deleteSurvey answered ${deleted.status}`);
  }
}

export interface StoredResponse {
  readonly id: string;
  readonly submittedAt: string;
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
  readonly respondentIp?: string;
  readonly partial?: boolean;
}

/** Every response Studio holds for the survey (`listResults`, first page of up to 1,000). */
export async function listResults(surveyId: string): Promise<StoredResponse[]> {
  const response = await studio("GET", `/surveys/${surveyId}/results?limit=1000`);
  if (response.status !== 200) throw new Error(`listResults answered ${response.status}`);
  return ((await response.json()) as { items: StoredResponse[] }).items;
}

/** Calls Studio and throws unless it answers `expected`. */
async function expectStatus(
  what: string,
  expected: number,
  ...call: Parameters<typeof studio>
): Promise<Response> {
  const response = await studio(...call);
  if (response.status !== expected) throw new Error(`${what} answered ${response.status}`);
  return response;
}

/** Saves the survey's theme. */
export async function saveTheme(surveyId: string, theme: unknown): Promise<void> {
  await expectStatus(
    "saveSurveyTheme",
    204,
    "PUT",
    `/surveys/${surveyId}/theme`,
    theme,
    "application/json",
    { "if-match": "*" },
  );
}

/** Saves the survey's shared results layout of `kind`, the text as given. */
export async function saveLayout(surveyId: string, kind: LayoutKind, text: string): Promise<void> {
  const response = await studio("PUT", `/surveys/${surveyId}/layouts/${kind}`, { text });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(`saveSurveyLayout answered ${response.status}`);
  }
}

/** Archives the survey. */
export async function archiveSurvey(surveyId: string): Promise<void> {
  await expectStatus(
    "archiving",
    200,
    "PATCH",
    `/surveys/${surveyId}`,
    { archived: true },
    "application/merge-patch+json",
  );
}

/** Where the owner's surveys can be: Personal and the fixture projects the owner belongs to. */
const OWNER_SPACES = [
  "personal",
  "55555555-0000-4000-8000-a00000000001",
  "55555555-0000-4000-8000-a00000000002",
];

/** The IDs of every survey the owner sees, active and archived. */
export async function ownerSurveyIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const project of OWNER_SPACES) {
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ project, archived: String(archived), limit: "200" });
        if (cursor !== null) query.set("cursor", cursor);
        const response = await expectStatus("listSurveys", 200, "GET", `/surveys?${query}`);
        const page = (await response.json()) as {
          items: { id: string }[];
          nextCursor: string | null;
        };
        for (const item of page.items) ids.add(item.id.toLowerCase());
        cursor = page.nextCursor;
      } while (cursor !== null);
    }
  }
  return ids;
}
