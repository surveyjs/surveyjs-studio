// The old writes: post (§3) and upload (§4), and what Studio stores for them.
import { describe, expect, it, onTestFinished } from "vitest";
import { goldenTests, send } from "./harness.js";
import { createSurvey, FEEDBACK_DEFINITION, listResults, removeSurvey } from "./studio.js";

describe("post", () => goldenTests(["post"]));
describe("upload", () => goldenTests(["upload"]));

/** Posts through the old action, as the Form Library v1 does; `headers` are added. */
function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return send({
    method: "POST",
    path: "/public/v1/Survey/post/",
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: { json: body },
  });
}

async function isCompleted(resultId: string, clientId: string): Promise<unknown> {
  const answer = await send({
    method: "GET",
    path: "/public/v1/Survey/isCompleted",
    query: { resultId, clientId },
  });
  return JSON.parse(answer.body.toString("utf8"));
}

describe("what post stores", () => {
  it("stores the answers as sent (no HTML encoding), the client ID and the caller's address", async () => {
    const survey = await createSurvey({ storeRespondentIp: true });
    onTestFinished(() => removeSurvey(survey.surveyId));
    const answers = { satisfaction: 4, comment: "<b>Tom & Jerry</b> <script>x</script>" };
    // The bridge trusts the suite as a proxy on loopback, so this names the caller; Studio
    // trusts the bridge and stores the address the bridge passes on.
    const answer = await post(
      { postId: survey.postId, surveyResult: JSON.stringify(answers), clientId: "client-ip" },
      { "x-forwarded-for": "203.0.113.99" },
    );
    expect(answer.status).toBe(200);
    const stored = await listResults(survey.surveyId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      data: answers,
      clientId: "client-ip",
      respondentIp: "203.0.113.99",
    });
    expect(stored[0]?.partial).toBeUndefined();
  });

  it("stores a partial save as partial, and the complete one ends it", async () => {
    const survey = await createSurvey();
    onTestFinished(() => removeSurvey(survey.surveyId));
    const partial = await post({
      postId: survey.postId,
      surveyResult: '{"satisfaction":2}',
      clientId: "client-p",
      isPartialCompleted: true,
    });
    expect(partial.status).toBe(200);
    expect(await listResults(survey.surveyId)).toMatchObject([
      { data: { satisfaction: 2 }, clientId: "client-p", partial: true },
    ]);
    expect(await isCompleted(survey.resultId, "client-p")).toBe("partial");

    const complete = await post({
      postId: survey.postId,
      surveyResult: '{"satisfaction":5}',
      clientId: "client-p",
    });
    expect(complete.status).toBe(200);
    const stored = await listResults(survey.surveyId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.data).toEqual({ satisfaction: 5 });
    expect(stored[0]?.partial).toBeUndefined();
    expect(await isCompleted(survey.resultId, "client-p")).toBe("completed");
  });

  it('stores a second post of a respondent who completed a "Limit to one response" survey', async () => {
    // A non-empty cookieName is "Limit to one response"; the old post never refused a respondent.
    const survey = await createSurvey(undefined, { ...FEEDBACK_DEFINITION, cookieName: "once" });
    onTestFinished(() => removeSurvey(survey.surveyId));
    for (const satisfaction of [3, 4]) {
      const answer = await post({
        postId: survey.postId,
        surveyResult: JSON.stringify({ satisfaction }),
        clientId: "client-once",
      });
      expect(answer.status).toBe(200);
    }
    const stored = await listResults(survey.surveyId);
    expect(stored.map((response) => response.data)).toEqual([
      { satisfaction: 3 },
      { satisfaction: 4 },
    ]);
    expect(await isCompleted(survey.resultId, "client-once")).toBe("completed");

    // The marker follows the post: a partial save after completing reads "partial" again.
    const partial = await post({
      postId: survey.postId,
      surveyResult: '{"satisfaction":1}',
      clientId: "client-once",
      isPartialCompleted: true,
    });
    expect(partial.status).toBe(200);
    expect(await isCompleted(survey.resultId, "client-once")).toBe("partial");
  });

  it("reads the answers and the partial flag as the old reader did", async () => {
    const survey = await createSurvey();
    onTestFinished(() => removeSurvey(survey.surveyId));
    // Unquoted names, single quotes, a comment and a trailing comma; the flag as a string.
    const answer = await post({
      postId: survey.postId,
      surveyResult: "{satisfaction: 3, comment: 'ok', /* note */ }",
      clientId: "client-lenient",
      isPartialCompleted: "true",
    });
    expect(answer.status).toBe(200);
    expect(await listResults(survey.surveyId)).toMatchObject([
      { data: { satisfaction: 3, comment: "ok" }, clientId: "client-lenient", partial: true },
    ]);
  });

  it("stores nothing for a refused post, nor for answers that are not a JSON object", async () => {
    const survey = await createSurvey();
    onTestFinished(() => removeSurvey(survey.surveyId));
    const refused = await post({ postId: survey.postId, surveyResult: "{}", clientId: "a/b" });
    expect(refused.status).toBe(400);
    const notAnObject = await post({
      postId: survey.postId,
      surveyResult: "[1,2]",
      clientId: "client-array",
    });
    expect(notAnObject.status).toBe(200);
    expect(await listResults(survey.surveyId)).toEqual([]);
    expect(await isCompleted(survey.resultId, "client-array")).toBe("no");
  });
});
