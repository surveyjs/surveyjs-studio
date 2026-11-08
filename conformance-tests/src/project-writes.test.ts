/**
 * `createProject`, `updateProject` and `deleteProject` against the legacy fixtures.
 *
 * Data rules: the data is shared by all test files and never reset (the Azurite replica keeps it
 * between runs), so Marketing, Engineering and every fixture membership are read only here. Every
 * test creates its own project with a unique name (`Conformance <purpose> <random>`), as Adam Admin
 * (Mia Member in the fallback case), and deletes it at the end. Only Mia and the blocked user are
 * ever added to such a project; never Olivia Owner or Oscar Outsider. Surveys a test creates live in
 * its own project and move to Adam's Personal scope when it is deleted, never to Olivia's. Cleanup
 * is registered with `onTestFinished` right after a project or survey is created, so it also runs
 * when a test fails: surveys are archived and deleted as Adam, projects deleted by whichever of the
 * test's users is still an admin.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, onTestFinished } from "vitest";
import { GUID, call, codeOf, as, cleanUp, sandbox } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { admin, member, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const MERGE_PATCH = "application/merge-patch+json";

type Headers = Record<string, string>;

interface Project {
  id: string;
  name: string;
  ownerId: string | null;
  role: string;
  memberCount: number;
  createdAt: string;
}

interface Survey {
  id: string;
  projectId: string | null;
  published: boolean;
  archived: boolean;
  createdAt: string;
  postId: string;
  resultId: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The same browser without the CSRF token header. */
const withoutCsrf = (headers: Headers): Headers => ({ cookie: headers.cookie ?? "" });

const uniqueName = (purpose: string): string =>
  `Conformance ${purpose} ${randomUUID().slice(0, 8)}`;

function create(headers: Headers, body: unknown): Promise<Response> {
  return call("POST", "/projects", { headers, body });
}

/**
 * Creates a project and registers its deletion; the first of `cleanupHeaders` (default: the
 * creator) that may still delete it does.
 */
async function createdProject(
  headers: Headers,
  purpose: string,
  cleanupHeaders: readonly Headers[] = [headers],
): Promise<Project> {
  const response = await create(headers, { name: uniqueName(purpose) });
  expect(response.status).toBe(201);
  const project = (await response.json()) as Project;
  onTestFinished(() => deleteProjectAsAnyOf(cleanupHeaders, project.id));
  return project;
}

async function deleteProjectAsAnyOf(candidates: readonly Headers[], id: string): Promise<void> {
  for (const headers of candidates) {
    if ((await remove(headers, id)).status === 204) return;
  }
}

function get(headers: Headers, id: string): Promise<Response> {
  return call("GET", "/projects/{projectId}", { path: `/projects/${id}`, headers });
}

function rename(
  headers: Headers,
  id: string,
  body: unknown,
  mediaType: string = MERGE_PATCH,
): Promise<Response> {
  return call("PATCH", "/projects/{projectId}", {
    path: `/projects/${id}`,
    headers: { "content-type": mediaType, ...headers },
    body,
  });
}

function remove(headers: Headers, id: string): Promise<Response> {
  return call("DELETE", "/projects/{projectId}", { path: `/projects/${id}`, headers });
}

async function addMember(headers: Headers, projectId: string, body: unknown): Promise<void> {
  const response = await call("POST", "/projects/{projectId}/members", {
    path: `/projects/${projectId}/members`,
    headers,
    body,
  });
  expect(response.status).toBe(201);
}

/** Every project of the user, following `nextCursor` to the end. */
async function projectsOf(headers: Headers): Promise<Project[]> {
  const items: Project[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await call("GET", "/projects", {
      path: `/projects?limit=200${query}`,
      headers,
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page<Project>;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

/** Every personal survey of the user, active or archived, following `nextCursor` to the end. */
async function personalSurveys(headers: Headers, archived: boolean): Promise<Survey[]> {
  const items: Survey[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const path = `/surveys?project=personal&archived=${archived}&limit=200${query}`;
    const response = await call("GET", "/surveys", { path, headers });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page<Survey>;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

function patchSurvey(headers: Headers, id: string, body: unknown): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": MERGE_PATCH, ...headers },
    body,
  });
}

async function readSurvey(headers: Headers, id: string): Promise<Survey> {
  const response = await call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect(response.status).toBe(200);
  return (await response.json()) as Survey;
}

/** Creates a survey in the project as `headers` (Adam) and registers its cleanup as Adam. */
async function createdSurvey(headers: Headers, projectId: string, body = {}): Promise<Survey> {
  const response = await call("POST", "/surveys", { headers, body: { ...body, projectId } });
  expect(response.status).toBe(201);
  const survey = (await response.json()) as Survey;
  onTestFinished(() => cleanUp(headers, survey.id));
  return survey;
}

describe("createProject", () => {
  it("makes the creator the first member, as admin and owner", async (ctx) => {
    const adam = await as(ctx, admin);
    const name = uniqueName("create");
    const response = await create(adam, { name });
    expect(response.status).toBe(201);
    const project = (await response.json()) as Project;
    onTestFinished(() => deleteProjectAsAnyOf([adam], project.id));
    expect(project).toEqual({
      id: expect.stringMatching(GUID) as string,
      name,
      ownerId: admin.id,
      role: "admin",
      memberCount: 1,
      createdAt: expect.any(String) as string,
    });
    expect(response.headers.get("location")).toBe(`/api/v1/projects/${project.id}`);

    const read = await get(adam, project.id);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(project);
    expect(await projectsOf(adam)).toContainEqual(project);

    const byMia = await get(await as(ctx, member), project.id);
    expect(byMia.status).toBe(404);
    expect(await codeOf(byMia)).toBe("not-found");
  });

  it("allows two projects with the same name", async (ctx) => {
    const adam = await as(ctx, admin);
    const first = await createdProject(adam, "same name");
    const response = await create(adam, { name: first.name });
    expect(response.status).toBe(201);
    const second = (await response.json()) as Project;
    onTestFinished(() => deleteProjectAsAnyOf([adam], second.id));
    expect(second.name).toBe(first.name);
    expect(second.id).not.toBe(first.id);
  });

  it("accepts a name of 128 characters and refuses one of 129", async (ctx) => {
    const adam = await as(ctx, admin);
    const base = uniqueName("length");
    const long = await create(adam, { name: base.padEnd(128, "x") });
    expect(long.status).toBe(201);
    const project = (await long.json()) as Project;
    onTestFinished(() => deleteProjectAsAnyOf([adam], project.id));
    expect(project.name).toHaveLength(128);

    const tooLong = await create(adam, { name: base.padEnd(129, "x") });
    expect(tooLong.status).toBe(422);
    expect(await codeOf(tooLong)).toBe("validation-failed");
  });

  it("answers 422 validation-failed for a missing, empty or blank name", async (ctx) => {
    const adam = await as(ctx, admin);
    for (const body of [{}, { name: "" }]) {
      const response = await create(adam, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    const blank = await create(adam, { name: "   " });
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
  });

  it("answers 400 for malformed JSON, 401 signed out and 403 without the CSRF token", async (ctx) => {
    const adam = await as(ctx, admin);
    const malformed = await call("POST", "/projects", { headers: adam, rawBody: "{" });
    expect(malformed.status).toBe(400);
    expect(await codeOf(malformed)).toBe("bad-request");

    const signedOut = await create({}, { name: uniqueName("signed out") });
    expect(signedOut.status).toBe(401);
    expect(await codeOf(signedOut)).toBe("unauthenticated");

    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      const noCsrf = await create(withoutCsrf(adam), { name: uniqueName("no csrf") });
      expect(noCsrf.status).toBe(403);
      expect(await codeOf(noCsrf)).toBe("csrf-token-invalid");
    }
  });
});

describe("updateProject", () => {
  it("renames as merge patch or JSON; createdAt and ownerId stay", async (ctx) => {
    const adam = await as(ctx, admin);
    const project = await createdProject(adam, "rename");

    const merged = await rename(adam, project.id, { name: `${project.name} (merge)` });
    expect(merged.status).toBe(200);
    expect(await merged.json()).toEqual({ ...project, name: `${project.name} (merge)` });

    const json = await rename(
      adam,
      project.id,
      { name: `${project.name} (json)` },
      "application/json",
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ ...project, name: `${project.name} (json)` });
  });

  it("refuses a plain member with 403, others with 404 and bad input with 400 or 422", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const project = await createdProject(adam, "rename refusals");
    await addMember(adam, project.id, { email: member.email });

    const byMember = await rename(mia, project.id, { name: "Mine" });
    expect(byMember.status).toBe(403);
    expect(await codeOf(byMember)).toBe("forbidden");

    for (const [headers, id] of [
      [await as(ctx, outsider), project.id],
      [adam, UNKNOWN_ID],
    ] as const) {
      const response = await rename(headers, id, { name: "Mine" });
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }

    const longId = await rename(adam, "x".repeat(65), { name: "Mine" });
    expect(longId.status).toBe(400);
    expect(await codeOf(longId)).toBe("bad-request");

    for (const body of [{}, { name: " " }]) {
      const response = await rename(adam, project.id, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    expect(await (await get(adam, project.id)).json()).toEqual({ ...project, memberCount: 2 });
  });
});

describe("deleteProject", () => {
  it("moves the surveys to the owner, with their ids, state and results", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const project = await createdProject(adam, "delete", [adam, mia]);
    await addMember(adam, project.id, { email: member.email, role: "admin" });

    const definition = { pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }] };
    const published = await createdSurvey(adam, project.id, { definition });
    expect((await patchSurvey(adam, published.id, { published: true })).status).toBe(200);
    const submitted = await call("POST", "/public/surveys/{surveyId}/responses", {
      path: `/public/surveys/${published.id}/responses`,
      body: { data: { q1: "a" } },
    });
    expect(submitted.status).toBe(201);
    const archived = await createdSurvey(adam, project.id);
    expect((await patchSurvey(adam, archived.id, { archived: true })).status).toBe(200);
    const before = [await readSurvey(adam, published.id), await readSurvey(adam, archived.id)];
    const kept = ({ id, postId, resultId, published: p, archived: a, createdAt }: Survey) => ({
      id,
      postId,
      resultId,
      published: p,
      archived: a,
      createdAt,
      projectId: null,
    });

    // Mia is an admin, not the owner: the surveys go to Adam.
    const deleted = await remove(mia, project.id);
    expect(deleted.status).toBe(204);

    const active = await personalSurveys(adam, false);
    expect(active.find((s) => s.id === published.id)).toMatchObject(kept(before[0] as Survey));
    expect(before[0]?.published).toBe(true);
    const archivedList = await personalSurveys(adam, true);
    expect(archivedList.find((s) => s.id === archived.id)).toMatchObject(kept(before[1] as Survey));

    const stats = await call("GET", "/surveys/{surveyId}/results/stats", {
      path: `/surveys/${published.id}/results/stats`,
      headers: adam,
    });
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ count: 1 });

    const miaSurveys = [
      ...(await personalSurveys(mia, false)),
      ...(await personalSurveys(mia, true)),
    ];
    expect(miaSurveys.map((s) => s.id)).not.toContain(published.id);
    expect(miaSurveys.map((s) => s.id)).not.toContain(archived.id);

    for (const headers of [adam, mia]) {
      const response = await get(headers, project.id);
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
    expect((await projectsOf(adam)).map((p) => p.id)).not.toContain(project.id);
    const again = await remove(adam, project.id);
    expect(again.status).toBe(404);
    expect(await codeOf(again)).toBe("not-found");
  });

  it("moves the surveys to the deleting admin once the owner has left", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const project = await createdProject(mia, "fallback", [mia, adam]);
    await addMember(mia, project.id, { email: admin.email, role: "admin" });
    const survey = await createdSurvey(adam, project.id);

    const left = await call("DELETE", "/projects/{projectId}/members/{userId}", {
      path: `/projects/${project.id}/members/${member.id}`,
      headers: mia,
    });
    expect(left.status).toBe(204);
    const read = await get(adam, project.id);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ ownerId: null, role: "admin", memberCount: 1 });

    expect((await remove(adam, project.id)).status).toBe(204);
    const moved = (await personalSurveys(adam, false)).find((s) => s.id === survey.id);
    expect(moved).toMatchObject({ id: survey.id, projectId: null, postId: survey.postId });
  });

  it("refuses a plain member with 403 and others with 404 or 400", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const project = await createdProject(adam, "delete refusals");
    await addMember(adam, project.id, { email: member.email });

    const byMember = await remove(mia, project.id);
    expect(byMember.status).toBe(403);
    expect(await codeOf(byMember)).toBe("forbidden");
    expect((await get(adam, project.id)).status).toBe(200);

    for (const [headers, id] of [
      [await as(ctx, outsider), project.id],
      [adam, UNKNOWN_ID],
    ] as const) {
      const response = await remove(headers, id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }

    const longId = await remove(adam, "x".repeat(65));
    expect(longId.status).toBe(400);
    expect(await codeOf(longId)).toBe("bad-request");

    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      const noCsrf = await remove(withoutCsrf(adam), project.id);
      expect(noCsrf.status).toBe(403);
      expect(await codeOf(noCsrf)).toBe("csrf-token-invalid");
    }
    expect((await get(adam, project.id)).status).toBe(200);
  });
});
