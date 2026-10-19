import { describe, expect, it } from "vitest";
import { LICENCE_EXPIRED, LICENCE_EXPIRES_SOON } from "../../notices/account-notices.js";
import { createSurveyjsApiDirectory, UserApiError, type SurveyjsApiOptions } from "./client.js";

const BASE = "https://users.example.test/api";
const TOKEN = "test-token-Secret-55";
const OWNER = "11111111-0000-4000-8000-a00000000001";
const NOW = Date.parse("2026-09-01T12:00:00Z");

const apiUser = (id = OWNER) => ({
  id,
  email: "owner@example.com",
  displayName: "Olivia Owner",
  blocked: false,
});

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Answer =
  Response | Error | ((request: Recorded, init: RequestInit) => Response | Promise<Response>);

function harness(answer: Answer | Answer[], extra: Partial<SurveyjsApiOptions> = {}) {
  const requests: Recorded[] = [];
  const queue = Array.isArray(answer) ? [...answer] : null;
  const fetchFake = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const request: Recorded = {
      url: String(url),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : null,
    };
    requests.push(request);
    const chosen: Answer = queue
      ? queue.length > 1
        ? queue.shift()!
        : queue[0]!
      : (answer as Answer);
    if (chosen instanceof Error) throw chosen;
    if (typeof chosen === "function") return chosen(request, init);
    return chosen.clone();
  }) as typeof fetch;
  const directory = createSurveyjsApiDirectory({
    baseUrl: BASE,
    token: TOKEN,
    fetch: fetchFake,
    now: () => NOW,
    ...extra,
  });
  return { ...directory, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Awaits a call that must reject with a UserApiError that does not leak the token. */
async function failure(promise: Promise<unknown>): Promise<UserApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UserApiError);
    const failed = error as UserApiError;
    expect(failed.message).not.toContain(TOKEN);
    expect(String(failed)).not.toContain(TOKEN);
    return failed;
  }
  throw new Error("expected the call to reject");
}

describe("getUser", () => {
  it("asks GET /users/<id lower> with the token and returns the mapped user", async () => {
    const { users, requests } = harness(json(apiUser()));
    expect(await users.getUser(OWNER.toUpperCase())).toEqual({
      id: OWNER,
      email: "owner@example.com",
      displayName: "Olivia Owner",
      blocked: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${BASE}/users/${OWNER}`,
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" },
    });
  });

  it("is external", () => {
    expect(harness(json({})).users.kind).toBe("external");
  });

  it("gives null for 404", async () => {
    expect(await harness(json({}, 404)).users.getUser(OWNER)).toBeNull();
  });

  it("gives null for an id that is not a GUID and makes no request", async () => {
    const { users, requests } = harness(json(apiUser()));
    expect(await users.getUser("not-a-guid")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["another id", json(apiUser("11111111-0000-4000-8000-a00000000002"))],
    ["invalid JSON", new Response("{nope", { status: 200 })],
    ["an empty object", json({})],
  ])("rejects with 'malformed answer' for %s", async (_name, answer) => {
    const error = await failure(harness(answer).users.getUser(OWNER));
    expect(error.message).toContain("malformed answer");
    expect(error.operation).toBe("user lookup");
  });

  it("rejects with the status for 500", async () => {
    const error = await failure(harness(json({}, 500)).users.getUser(OWNER));
    expect(error.status).toBe(500);
    expect(error.message).toContain("status 500");
  });

  it("rejects with 'network error' when fetch throws, whatever the error says", async () => {
    const error = await failure(harness(new TypeError(`bad ${TOKEN}`)).users.getUser(OWNER));
    expect(error.status).toBeNull();
    expect(error.message).toContain("network error");
  });

  it("rejects with 'timeout' for a call that never answers", async () => {
    const hang: Answer = (_request, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const error = await failure(harness(hang, { timeoutMs: 20 }).users.getUser(OWNER));
    expect(error.message).toContain("timeout");
  });
});

describe("findUserByEmail", () => {
  it("POSTs the lower-cased email in the body, not the URL", async () => {
    const { users, requests } = harness(json(apiUser()));
    expect((await users.findUserByEmail("Owner@Example.com"))?.id).toBe(OWNER);
    expect(requests[0]).toMatchObject({
      url: `${BASE}/users/by-email`,
      method: "POST",
      body: '{"email":"owner@example.com"}',
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    });
    expect(requests[0]!.url).not.toContain("example.com");
  });

  it("gives null for a blank email and makes no request", async () => {
    const { users, requests } = harness(json(apiUser()));
    expect(await users.findUserByEmail("  ")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("gives null for 404 and rejects for 502", async () => {
    expect(await harness(json({}, 404)).users.findUserByEmail("a@example.com")).toBeNull();
    const error = await failure(harness(json({}, 502)).users.findUserByEmail("a@example.com"));
    expect(error.operation).toBe("user lookup by email");
    expect(error.status).toBe(502);
  });
});

describe("signInUser", () => {
  it("makes one GET /users/{sub}", async () => {
    const { users, requests } = harness(json(apiUser()));
    const user = await users.signInUser({ sub: OWNER } as never);
    expect(user?.id).toBe(OWNER);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${BASE}/users/${OWNER}`]);
  });
});

describe("missingUsers", () => {
  const guid = (n: number) => `22222222-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("asks in chunks of 100 over the unique GUIDs and reports the absent ones in input order", async () => {
    const ids = Array.from({ length: 205 }, (_, n) => guid(n));
    const absent = new Set([guid(3), guid(150), guid(204)]);
    const { users, requests } = harness((request) => {
      const asked = (JSON.parse(request.body ?? "{}") as { ids: string[] }).ids;
      return json({ users: asked.filter((id) => !absent.has(id)).map((id) => apiUser(id)) });
    });
    const input = [...ids, ...ids.slice(0, 5).map((id) => id.toUpperCase()), "x"];
    expect(await users.missingUsers(input)).toEqual([guid(3), guid(150), guid(204)]);
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.method === "POST" && r.url === `${BASE}/users/lookup`)).toBe(
      true,
    );
    expect(requests.map((r) => (JSON.parse(r.body!) as { ids: string[] }).ids.length)).toEqual([
      100, 100, 5,
    ]);
  });

  it("rejects the whole call when one chunk fails", async () => {
    const ids = Array.from({ length: 150 }, (_, n) => guid(n));
    const error = await failure(
      harness([json({ users: [] }), json({}, 503)]).users.missingUsers(ids),
    );
    expect(error.operation).toBe("user batch lookup");
    expect(error.status).toBe(503);
  });

  it("rejects a 404, so a wrong base URL never reports every id as missing", async () => {
    const error = await failure(harness(json({}, 404)).users.missingUsers([guid(1)]));
    expect(error.operation).toBe("user batch lookup");
    expect(error.status).toBe(404);
  });

  it("rejects a malformed answer", async () => {
    const error = await failure(harness(json({})).users.missingUsers([guid(1)]));
    expect(error.message).toContain("malformed answer");
  });

  it("makes no request when no id is a GUID", async () => {
    const { users, requests } = harness(json({ users: [] }));
    expect(await users.missingUsers(["x"])).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});

describe("notices", () => {
  const options = { accountNotices: "surveyjs-licenses" } as const;

  it("gives the expired notice for a past licence", async () => {
    const { notices, requests } = harness(
      json({ licences: [{ expiresAt: "2026-08-01T00:00:00Z" }] }),
      options,
    );
    expect(await notices.noticesFor(OWNER.toUpperCase())).toEqual([LICENCE_EXPIRED]);
    expect(requests[0]).toMatchObject({ url: `${BASE}/users/${OWNER}/licences`, method: "GET" });
  });

  it("gives the expires-soon notice near the end", async () => {
    const { notices } = harness(
      json({ licences: [{ expiresAt: "2026-09-10T00:00:00Z" }] }),
      options,
    );
    expect(await notices.noticesFor(OWNER)).toEqual([LICENCE_EXPIRES_SOON]);
  });

  it("gives [] for 404 and for an id that is not a GUID", async () => {
    const { notices, requests } = harness(json({}, 404), options);
    expect(await notices.noticesFor(OWNER)).toEqual([]);
    expect(await notices.noticesFor("nope")).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("rejects for a failure and for a malformed answer", async () => {
    const failed = await failure(harness(json({}, 500), options).notices.noticesFor(OWNER));
    expect(failed.operation).toBe("licence list");
    const malformed = await failure(harness(json({}), options).notices.noticesFor(OWNER));
    expect(malformed.message).toContain("malformed answer");
  });

  it("gives the demo notice and makes no request for another setting", async () => {
    const { notices, requests } = harness(json({}), { accountNotices: "license-expired" });
    expect(await notices.noticesFor(OWNER)).toEqual([LICENCE_EXPIRED]);
    expect(requests).toHaveLength(0);
  });

  it("defaults to no notices", async () => {
    expect(await harness(json({})).notices.noticesFor(OWNER)).toEqual([]);
  });
});

describe("every call", () => {
  it("refuses to follow a redirect, so the token never goes to another address", async () => {
    const seen: RequestInit["redirect"][] = [];
    const { users } = harness((request, init) => {
      seen.push(init.redirect);
      return request.url.endsWith("/users/lookup") ? json({ users: [] }) : json(apiUser());
    });
    await users.getUser(OWNER);
    await users.findUserByEmail("owner@example.com");
    await users.missingUsers([OWNER]);
    expect(seen).toEqual(["error", "error", "error"]);
  });

  it("reads a redirect it refused as a network error", async () => {
    const error = await failure(
      harness(new TypeError("fetch failed: unexpected redirect")).users.getUser(OWNER),
    );
    expect(error.message).toContain("network error");
  });

  it("releases the body of an answer it does not read", async () => {
    const answers: Response[] = [];
    const answer = (status: number) => () => {
      const response = new Response("an error page", { status });
      answers.push(response);
      return response;
    };
    await failure(harness(answer(503)).users.getUser(OWNER));
    expect(await harness(answer(404)).users.getUser(OWNER)).toBeNull();
    expect(answers.map((response) => response.bodyUsed)).toEqual([true, true]);
  });
});
