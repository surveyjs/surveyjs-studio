// A fake Studio for the action tests: the public operations the bridge calls, answered from maps
// the test fills, with every request recorded. `override` answers a request differently (a status
// the test wants) before the fake's own routing.
import type { ServerResponse } from "node:http";
import { startStub, type RecordedRequest, type Stub } from "./http.js";

export type RespondentState = "none" | "partial" | "completed";

export interface StoredDefinition {
  definition: unknown;
  /** The strong ETag Studio sends; `undefined` sends none. */
  etag: string | undefined;
}

export interface FakeStudio extends Stub {
  /** Definitions by survey ID. */
  definitions: Map<string, StoredDefinition>;
  /** Respondent states by `surveyId/clientId` (the client ID decoded). */
  states: Map<string, RespondentState>;
  /** Result ID → survey ID; post ID → survey ID. */
  resultIds: Map<string, string>;
  postIds: Map<string, string>;
  /** Answers a request itself when it returns true. */
  override: ((request: RecordedRequest, res: ServerResponse) => boolean) | undefined;
  /** The file Studio answers an upload with. */
  storedFile: { id: string; url: string; name: string; contentType: string; size: number };
  /** Clears the maps, the recorded requests and the override. */
  reset(): void;
}

const API = "/api/v1";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function problem(res: ServerResponse, status: number): void {
  res
    .writeHead(status, { "content-type": "application/problem+json" })
    .end(JSON.stringify({ type: "about:blank", title: "Problem", status }));
}

export async function startFakeStudio(): Promise<FakeStudio> {
  // The handler reads the returned object, so a test's changes apply to the next request.
  const holder: { studio?: FakeStudio } = {};

  const stub = await startStub((request, res) => {
    const fake = holder.studio!;
    if (fake.override?.(request, res) === true) return;
    const url = new URL(request.url, "http://studio");
    if (!url.pathname.startsWith(`${API}/public/`)) return problem(res, 404);
    // e.g. ["surveys", "<id>", "definition"]: the route is "surveys/:/definition".
    const segments = url.pathname
      .slice(`${API}/public/`.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
    const route = `${request.method} ${segments.map((s, i) => (i % 2 === 1 ? ":" : s)).join("/")}`;
    const id = segments[1]!;

    switch (route) {
      case "GET surveys/:/definition": {
        const stored = fake.definitions.get(id);
        if (!stored) return problem(res, 404);
        const headers: Record<string, string> = { "cache-control": "no-cache" };
        if (stored.etag !== undefined) headers.etag = stored.etag;
        if (stored.etag !== undefined && request.headers["if-none-match"] === stored.etag) {
          res.writeHead(304, headers).end();
          return;
        }
        res
          .writeHead(200, { ...headers, "content-type": "application/json" })
          .end(JSON.stringify(stored.definition));
        return;
      }
      case "GET surveys/:/respondents/:":
      case "GET results/:/respondents/:": {
        const surveyId =
          segments[0] === "surveys"
            ? fake.definitions.has(id)
              ? id
              : undefined
            : fake.resultIds.get(id);
        if (surveyId === undefined) return problem(res, 404);
        return json(res, 200, { state: fake.states.get(`${surveyId}/${segments[3]}`) ?? "none" });
      }
      case "POST posts/:/responses":
        if (!fake.postIds.has(id)) return problem(res, 404);
        return json(res, 201, { id: "r1" });
      case "POST posts/:/files":
        if (!fake.postIds.has(id)) return problem(res, 404);
        return json(res, 201, fake.storedFile);
      default:
        return problem(res, 404);
    }
  });

  const fake: FakeStudio = {
    ...stub,
    definitions: new Map(),
    states: new Map(),
    resultIds: new Map(),
    postIds: new Map(),
    override: undefined,
    storedFile: {
      id: "5af48e08a0a544a583f41c90e8e98de10123456789abcdef0123456789abcdef",
      url: "http://studio.test/api/v1/public/files/5af48e08",
      name: "x",
      contentType: "application/octet-stream",
      size: 1,
    },
    reset(): void {
      fake.definitions.clear();
      fake.states.clear();
      fake.resultIds.clear();
      fake.postIds.clear();
      fake.requests.length = 0;
      fake.override = undefined;
    },
  };
  holder.studio = fake;
  return fake;
}
