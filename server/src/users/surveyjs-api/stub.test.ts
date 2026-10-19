import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUserApiStub, stubDataFromFixtures, type UserApiStub } from "./stub.js";

const TOKEN = "stub-test-token";
const OWNER = "11111111-0000-4000-8000-a00000000001";
const MEMBER = "11111111-0000-4000-8000-a00000000003";
const OUTSIDER = "11111111-0000-4000-8000-a00000000004";
const ERASABLE = "11111111-0000-4000-8000-a00000000006";

let stub: UserApiStub;
let closed = false;
beforeAll(async () => {
  stub = await startUserApiStub({ data: await stubDataFromFixtures(), token: TOKEN, port: 0 });
});
afterAll(async () => {
  if (!closed) await stub.close();
});

const auth = { authorization: `Bearer ${TOKEN}` };
const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(`${stub.url}${path}`, { headers });
const post = (path: string, body: string, headers: Record<string, string> = auth) =>
  fetch(`${stub.url}${path}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  });

describe("the user API stub", () => {
  it("answers /healthz without a token", async () => {
    const response = await get("/healthz", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 401 for a user route without or with a wrong token", async () => {
    expect((await get(`/users/${OWNER}`, {})).status).toBe(401);
    expect((await get(`/users/${OWNER}`, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await post("/users/by-email", "{}", {})).status).toBe(401);
    expect(await (await get(`/users/${OWNER}`, {})).json()).toEqual({ error: "unauthorized" });
  });

  it("serializes a user as exactly its four members, whatever the id's case", async () => {
    for (const id of [OWNER, OWNER.toUpperCase()]) {
      const body = (await (await get(`/users/${id}`)).json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["blocked", "displayName", "email", "id"]);
      expect(body).toEqual({
        id: OWNER,
        email: "owner@example.com",
        displayName: "Olivia Owner",
        blocked: false,
      });
    }
  });

  it("answers 404 for an unknown user, another route and another method", async () => {
    expect((await get("/users/99999999-9999-4999-8999-999999999999")).status).toBe(404);
    expect((await get("/nothing")).status).toBe(404);
    expect(
      (await fetch(`${stub.url}/users/${OWNER}`, { method: "DELETE", headers: auth })).status,
    ).toBe(404);
    expect(await (await get("/nothing")).json()).toEqual({ error: "not found" });
  });

  it("finds a user by email, ignoring case", async () => {
    const response = await post("/users/by-email", JSON.stringify({ email: "OWNER@Example.COM" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(OWNER);
    expect(
      (await post("/users/by-email", JSON.stringify({ email: "nobody@example.com" }))).status,
    ).toBe(404);
  });

  it("looks up many users and answers the known ones", async () => {
    const response = await post(
      "/users/lookup",
      JSON.stringify({ ids: [OWNER.toUpperCase(), "x", MEMBER] }),
    );
    expect(response.status).toBe(200);
    const { users } = (await response.json()) as { users: { id: string }[] };
    expect(users.map((u) => u.id)).toEqual([OWNER, MEMBER]);
  });

  it("answers 400 for 101 ids, a wrong shape and a body that is not JSON", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, n) => `22222222-0000-4000-8000-${String(n).padStart(12, "0")}`,
    );
    expect((await post("/users/lookup", JSON.stringify({ ids }))).status).toBe(400);
    expect((await post("/users/lookup", JSON.stringify({ ids: [1] }))).status).toBe(400);
    expect((await post("/users/lookup", JSON.stringify({}))).status).toBe(400);
    const bad = await post("/users/lookup", "{");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad request" });
    expect((await post("/users/by-email", "{")).status).toBe(400);
  });

  it("lists the licences of the fixtures", async () => {
    const licences = async (id: string) =>
      (
        (await (await get(`/users/${id}/licences`)).json()) as {
          licences: { expiresAt: string | null }[];
        }
      ).licences.map((l) => l.expiresAt);
    expect(await licences(OWNER)).toEqual(["2026-08-01T00:00:00.000Z", "2027-06-01T00:00:00.000Z"]);
    expect(await licences(MEMBER)).toEqual(["2027-06-01T00:00:00.000Z"]);
    expect(await licences(OUTSIDER)).toEqual([null, "2027-06-01T00:00:00.000Z"]);
    expect(await licences(ERASABLE)).toEqual([]);
    expect((await get("/users/99999999-9999-4999-8999-999999999999/licences")).status).toBe(404);
  });

  it("refuses requests after close()", async () => {
    await stub.close();
    closed = true;
    await expect(get("/healthz", {})).rejects.toThrow();
  });
});
