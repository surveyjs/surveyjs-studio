import { HttpResponse, http as mswHttp, type HttpHandler } from "msw";
import type { components } from "@surveyjs-studio/contract/types";
import { currentUser } from "./server";

type Member = components["schemas"]["Member"];

/** The signed-in test user as a project admin. */
export const selfMember: Member = {
  userId: currentUser.id,
  displayName: currentUser.displayName,
  email: currentUser.email,
  role: "admin",
};

export const otherMember: Member = {
  userId: "00000000-0000-4000-8000-000000000003",
  displayName: "Mia Member",
  email: "member@example.test",
  role: "user",
};

/** Answers `GET /projects/{id}/members` with one page; `onRequest` sees each request URL. */
export function membersHandler(
  members: (projectId: string) => Member[],
  onRequest?: (url: URL) => void,
) {
  return mswHttp.get("*/api/v1/projects/:projectId/members", ({ request, params }) => {
    onRequest?.(new URL(request.url));
    return HttpResponse.json({ items: members(String(params.projectId)), nextCursor: null });
  });
}

/** One project or member write as the server received it. */
export interface RecordedWrite {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | null;
  readonly csrf: string | null;
  readonly body: unknown;
}

/** The answer to a write: a status and a JSON body (a Problem when the status is 400 or more). */
export interface WriteAnswer {
  readonly status: number;
  readonly body?: unknown;
}

export const problemAnswer = (status: number, code: string): WriteAnswer => ({
  status,
  body: { type: `https://studio.surveyjs.io/problems/${code}`, title: code, status, code },
});

/**
 * Answers every project and member write (create, rename, delete, add, change role, remove) with
 * `answer(write)` and records it in `writes`.
 */
export function projectWriteHandlers(
  writes: RecordedWrite[],
  answer: (write: RecordedWrite) => WriteAnswer,
): HttpHandler[] {
  const handle = async ({ request }: { request: Request }) => {
    const write: RecordedWrite = {
      method: request.method,
      path: new URL(request.url).pathname,
      contentType: request.headers.get("content-type"),
      csrf: request.headers.get("x-csrf-token"),
      body: request.method === "DELETE" ? null : await request.json().catch(() => null),
    };
    writes.push(write);
    const { status, body } = answer(write);
    if (status === 204) return new HttpResponse(null, { status });
    return HttpResponse.json(body ?? null, {
      status,
      headers: status >= 400 ? { "Content-Type": "application/problem+json" } : {},
    });
  };
  return [
    mswHttp.post("*/api/v1/projects", handle),
    mswHttp.patch("*/api/v1/projects/:projectId", handle),
    mswHttp.delete("*/api/v1/projects/:projectId", handle),
    mswHttp.post("*/api/v1/projects/:projectId/members", handle),
    mswHttp.patch("*/api/v1/projects/:projectId/members/:userId", handle),
    mswHttp.delete("*/api/v1/projects/:projectId/members/:userId", handle),
  ];
}
