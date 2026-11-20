// API tokens through the bridge, against real Studio (hosted Step 6, ADR 0040 point 2): a Personal
// token sees only the personal surveys, an `ownerId` naming a project falls back to them, a project
// survey gets the old refusal answers, and `generateAccessKey` rotates the token. A token is made
// for each test through the owner's signed-in session and deleted after it. Its value never
// reaches an assertion message: every answer is masked (`{{apiToken}}`) before it is compared, as
// the golden files mask the keys.
import { describe, expect, it, onTestFinished } from "vitest";
import { compareAnswer, type Answer, type GoldenRequest, type GoldenResponse } from "./golden.js";
import { KEYS, send } from "./harness.js";
import { createSurvey, listResults, OWNER_ID, removeSurvey, studio } from "./studio.js";

/** A fixture project the owner is an admin of (server/fixtures/legacy). */
const PROJECT_ID = "55555555-0000-4000-8000-a00000000001";

const PRIVATE = "/private/v1/Surveys";

interface Token {
  readonly id: string;
  readonly value: string;
}

/** A Personal API token of the owner, made through the owner's session; deleted after the test. */
async function personalToken(): Promise<Token> {
  const created = await studio("POST", "/api-tokens", {
    name: "Legacy compat bridge",
    projectId: null,
  });
  if (created.status !== 201) throw new Error(`createApiToken answered ${created.status}`);
  const { token, value } = (await created.json()) as { token: { id: string }; value: string };
  onTestFinished(async () => {
    // A rotated token keeps its ID, so this deletes it whatever its value is now.
    const deleted = await studio("DELETE", `/api-tokens/${token.id}`);
    if (deleted.status !== 204) throw new Error(`deleteApiToken answered ${deleted.status}`);
  });
  return { id: token.id, value };
}

/** The answer with every occurrence of the token values replaced by `{{apiToken}}`. */
function masked(answer: Answer, ...values: string[]): Answer {
  const mask = (text: string) =>
    values.reduce((out, value) => out.replaceAll(value, "{{apiToken}}"), text);
  return {
    ...answer,
    headers: Object.fromEntries(
      Object.entries(answer.headers).map(([name, value]) => [name, mask(String(value))]),
    ),
    body: Buffer.from(mask(answer.body.toString("utf8")), "utf8"),
  };
}

/** Sends the request with `accessKey` set to the token; the answer comes back masked. */
async function sendWith(token: string, request: GoldenRequest): Promise<Answer> {
  const query = { ...(request.query as Record<string, string>), accessKey: token };
  return masked(await send({ ...request, query }), token);
}

function json(answer: Answer): unknown {
  return JSON.parse(answer.body.toString("utf8"));
}

/** The empty `401` of the actions that require sign-in (golden `getActive/wrong-key`). */
const EMPTY_401: GoldenResponse = {
  status: 401,
  headers: { "content-type": null, "content-length": "0", location: null },
  body: null,
};

/** The empty `400` of an unknown survey (golden `getSurveyInfo/unknown`). */
const EMPTY_400: GoldenResponse = {
  status: 400,
  headers: { "content-type": null, "content-length": "0" },
  body: null,
};

/** A survey in the fixture project, made by the owner; removed after the test. */
async function projectSurvey() {
  const survey = await createSurvey(undefined, undefined, PROJECT_ID);
  onTestFinished(() => removeSurvey(survey.surveyId));
  return survey;
}

describe("a Personal API token through the bridge", () => {
  it("getActive with a project ownerId answers the personal surveys", async () => {
    const token = await personalToken();
    const getActive = (query: Record<string, string>): GoldenRequest => ({
      method: "GET",
      path: `${PRIVATE}/getActive`,
      query,
    });
    // What the owner's legacy key sees: the personal surveys, and the project's with its ownerId.
    const personal = await send(getActive({ accessKey: KEYS.accessKey }));
    const project = await send(getActive({ accessKey: KEYS.accessKey, ownerId: PROJECT_ID }));
    expect(personal.status).toBe(200);
    expect(project.status).toBe(200);
    expect(json(project)).not.toEqual(json(personal));

    const byToken = await sendWith(token.value, getActive({ ownerId: PROJECT_ID }));
    expect(byToken.status).toBe(200);
    expect(byToken.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(json(byToken)).toEqual(json(personal));
    expect((json(byToken) as { UserId: string }[]).map((survey) => survey.UserId)).toEqual(
      (json(personal) as unknown[]).map(() => OWNER_ID),
    );
    const plain = await sendWith(token.value, getActive({}));
    expect(json(plain)).toEqual(json(personal));
  });

  it("getSurveyInfo on a project survey answers the unknown survey's empty 400", async () => {
    const token = await personalToken();
    const survey = await projectSurvey();
    const getSurveyInfo = (query: Record<string, string>): GoldenRequest => ({
      method: "GET",
      path: `${PRIVATE}/getSurveyInfo`,
      query: { surveyId: survey.surveyId, ...query },
    });
    // The owner's legacy key sees it.
    const byKey = await send(getSurveyInfo({ accessKey: KEYS.accessKey, ownerId: PROJECT_ID }));
    expect(byKey.status).toBe(200);

    for (const query of [{ ownerId: PROJECT_ID }, {}] as Record<string, string>[]) {
      const answer = await sendWith(token.value, getSurveyInfo(query));
      expect(compareAnswer(EMPTY_400, answer), JSON.stringify(query)).toEqual([]);
    }
  });

  it("deleteResult on a project survey answers the modify refusal and deletes nothing", async () => {
    const token = await personalToken();
    const survey = await projectSurvey();
    for (const surveyResult of ['{"satisfaction":4}', '{"satisfaction":2}']) {
      const posted = await send({
        method: "POST",
        path: "/public/v1/Survey/post/",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { json: { postId: survey.postId, surveyResult } },
      });
      expect(posted.status).toBe(200);
    }
    const before = await listResults(survey.surveyId);
    expect(before).toHaveLength(2);

    const answer = await sendWith(token.value, {
      method: "DELETE",
      path: `${PRIVATE}/deleteResult`,
      query: { postId: survey.postId, instanceId: before[0]!.id },
    });
    // The old answer for a survey the caller cannot change (golden `deleteResult/member`).
    const refusal: GoldenResponse = {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { json: `You are not authorized to modify the survey ${survey.postId}` },
    };
    expect(compareAnswer(refusal, answer)).toEqual([]);
    expect((await listResults(survey.surveyId)).map((response) => response.id)).toEqual(
      before.map((response) => response.id),
    );
  });

  it("generateAccessKey rotates the token and answers the new value as a JSON string", async () => {
    const token = await personalToken();
    const generate: GoldenRequest = { method: "GET", path: "/private/Surveys/generateAccessKey" };
    const query = { accessKey: token.value };
    const raw = await send({ ...generate, query });
    expect(raw.status).toBe(200);
    expect(raw.headers["content-type"]).toBe("application/json; charset=utf-8");
    // A header the old API did not send: no cache keeps the new token.
    expect(raw.headers["cache-control"]).toBe("no-store");
    const rotated = JSON.parse(raw.body.toString("utf8")) as unknown;
    // Checked without quoting the value in a message.
    expect(typeof rotated === "string" && /^sjs_[A-Za-z0-9_-]{43}$/.test(rotated)).toBe(true);
    const fresh = rotated as string;
    expect(fresh === token.value).toBe(false);

    // The old value gets the bad-key answers at once: the empty 401, and generateAccessKey's text.
    const getActive: GoldenRequest = { method: "GET", path: `${PRIVATE}/getActive` };
    const old = await sendWith(token.value, getActive);
    expect(compareAnswer(EMPTY_401, old)).toEqual([]);
    const again = await sendWith(token.value, generate);
    expect(
      compareAnswer(
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": null },
          body: { text: "The accessKey '{{apiToken}}' is incorrect." },
        },
        again,
      ),
    ).toEqual([]);

    // The new value works, within the same Personal scope.
    const works = masked(await send({ ...getActive, query: { accessKey: fresh } }), fresh);
    expect(works.status).toBe(200);
    const personal = await send({ ...getActive, query: { accessKey: KEYS.accessKey } });
    expect(json(works)).toEqual(json(personal));
  });
});
