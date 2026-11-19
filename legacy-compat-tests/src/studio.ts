// Studio's own API, as the survey owner: the suite creates the surveys its state-changing cases
// run on and reads back what the bridge stored. Signs in over HTTP as a browser would, through the
// OAuth stub's form (memory), the mock OIDC server's login form (Azurite) or the dev provider's
// "Sign in as…" page (a server started with it).
import { inject } from "vitest";

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
): Promise<Response> {
  return fetch(`${STUDIO_URL}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(await ownerHeaders()),
      ...(body !== undefined && { "content-type": contentType }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

export interface FreshSurvey {
  readonly surveyId: string;
  readonly postId: string;
  readonly resultId: string;
}

/** The definition of the fixture "Customer feedback", given to fresh surveys. */
export const FEEDBACK_DEFINITION = {
  title: "Customer feedback",
  pages: [
    {
      name: "page1",
      elements: [
        { type: "rating", name: "satisfaction", title: "How satisfied are you?" },
        { type: "file", name: "receipt", title: "Upload your receipt" },
      ],
    },
  ],
};

/**
 * Creates a survey as the owner with the feedback definition, and with `settings` (publicResults,
 * storeRespondentIp, privateResultQuestions) when given. Remove it with `removeSurvey`.
 */
export async function createSurvey(
  settings?: Record<string, unknown>,
  definition: unknown = FEEDBACK_DEFINITION,
): Promise<FreshSurvey> {
  const created = await studio("POST", "/surveys", { name: "Legacy compat", definition });
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
