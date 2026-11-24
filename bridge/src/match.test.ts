import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchAction } from "./match.js";
import { ACTIONS } from "./mapping.js";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "./testing/http.js";
import { startFakeStudio, type FakeStudio } from "./testing/studio-stub.js";

const PREFIXES = {
  public: ["/public/Survey", "/public/v1/Survey"],
  private: ["/private/Surveys", "/private/v1/Surveys"],
} as const;
const SOME_ID = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";

describe("matchAction", () => {
  it("finds every entry under both prefixes, in upper case and with a trailing slash", () => {
    for (const entry of ACTIONS) {
      for (const prefix of PREFIXES[entry.controller]) {
        for (const path of entry.paths) {
          const url = path === "" ? prefix : `${prefix}/${path.replace(/:[A-Za-z]+/g, SOME_ID)}`;
          for (const method of entry.methods) {
            for (const variant of [url, url.toUpperCase(), `${url}/`, `${url.toLowerCase()}/`]) {
              expect(matchAction(method, variant)?.action, `${method} ${variant}`).toBe(
                entry.action,
              );
            }
          }
        }
      }
    }
  });

  it("matches a query-less path only: the query is not part of it", () => {
    expect(matchAction("GET", "/public/Survey/getSurvey")?.action).toBe("getSurvey");
    expect(matchAction("GET", "/public/Survey/getSurvey?x=1")?.action).toBe("getSurvey");
  });

  it("forwards what no entry holds", () => {
    for (const [method, path] of [
      ["POST", "/public/Survey/getSurvey"],
      ["GET", "/public/Survey/nope"],
      ["GET", "/public/Survey/getSurvey/extra"],
      ["GET", "/private/Surveys/getSurvey"],
      ["GET", "/public/Survey"],
      ["GET", "/public/Survey/getSurvey//"],
      ["GET", "/api/v1/surveys"],
      ["GET", "/"],
    ]) {
      expect(matchAction(method!, path!), `${method} ${path}`).toBeUndefined();
    }
  });

  it("takes :id as one non-empty segment", () => {
    const entry = ACTIONS.find((e) => e.paths.some((p) => p.includes(":id")))!;
    const name = entry.paths.find((p) => p.includes(":id"))!.replace("/:id", "");
    const base = `${PREFIXES[entry.controller][0]}/${name}`;
    const method = entry.methods[0]!;
    expect(matchAction(method, `${base}/abc`)).toBe(entry);
    expect(matchAction(method, `${base}/a/b`)).toBeUndefined();
    expect(matchAction(method, `${base}///`)).toBeUndefined();
  });

  describe("against the real router", () => {
    let legacy: Stub;
    let studio: FakeStudio;
    let bridge: RunningBridge;

    beforeAll(async () => {
      legacy = await startStub((_request, res) => res.writeHead(200).end("old"));
      studio = await startFakeStudio();
      bridge = await startBridge({ studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url });
    });
    afterAll(async () => {
      await bridge.close();
      await studio.close();
      await legacy.close();
    });

    it("routes exactly what matchAction finds, and forwards the rest", async () => {
      const samples: [string, string][] = [];
      for (const entry of ACTIONS) {
        const prefix = PREFIXES[entry.controller][1];
        const path = entry.paths[entry.paths.length - 1]!.replace(/:[A-Za-z]+/g, SOME_ID);
        const url = path === "" ? prefix : `${prefix}/${path}`;
        for (const method of ["GET", "POST", "PUT", "DELETE", "HEAD"]) {
          for (const variant of [url, url.toUpperCase(), `${url}/`, `${url}/x`, `${url}//`]) {
            samples.push([method, variant]);
          }
        }
      }
      samples.push(["GET", "/public/Survey"], ["GET", "/private/Surveys/getSurvey"]);
      // One bridge, one stub: send in batches, then check each sample's forwarding by its own
      // path (the stub records the URL it was sent).
      const BATCH = 20;
      for (let i = 0; i < samples.length; i += BATCH) {
        const batch = samples.slice(i, i + BATCH);
        legacy.requests.length = 0;
        await Promise.all(batch.map(([method, path]) => send(`${bridge.url}${path}`, { method })));
        const forwarded = new Set(legacy.requests.map((r) => `${r.method} ${r.url}`));
        for (const [method, path] of batch) {
          expect(matchAction(method, path) === undefined, `${method} ${path}`).toBe(
            forwarded.has(`${method} ${path}`),
          );
        }
      }
    }, 60_000);
  });
});
