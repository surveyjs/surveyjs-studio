// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://forms.example.test/" }
//
// The Form Library v1 (survey-core 1.x, pinned in this package only) against the bridge, as pages
// built for the old service use it: XMLHttpRequest from another origin (so CORS applies), the
// service URL pointed at the bridge.
import { settings, SurveyModel, type QuestionFileModel } from "survey-core";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { BASE_URL } from "./harness.js";
import { createSurvey, listResults, removeSurvey } from "./studio.js";

const FEEDBACK_ID = "22222222-0000-4000-8000-a00000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(() => {
  // v1's default is https://api.surveyjs.io/public/v1/Survey; the bridge answers on that path.
  settings.web.surveyServiceUrl = `${BASE_URL}/public/v1/Survey`;
});

/**
 * Waits until the model has finished loading from the service (its `state` leaves `loading`); fails
 * when nothing was loaded.
 */
function loaded(model: SurveyModel): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const check = () => {
      if (model.state !== "loading") {
        if (model.getAllQuestions().length > 0) resolve();
        else reject(new Error("the survey did not load"));
      } else if (Date.now() > deadline) {
        reject(new Error("the survey is still loading after 10 s"));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
}

/** The next `onSendResult` of the model. */
function sent(model: SurveyModel): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const handler = (_sender: SurveyModel, options: { success: boolean }) => {
      model.onSendResult.remove(handler);
      resolve(options);
    };
    model.onSendResult.add(handler);
  });
}

describe("Form Library v1", () => {
  it("loads a survey by surveyId (getSurvey)", async () => {
    const model = new SurveyModel({ surveyId: FEEDBACK_ID });
    await loaded(model);
    expect(model.title).toBe("Customer feedback");
    expect(model.getAllQuestions().map((question) => question.name)).toEqual([
      "satisfaction",
      "receipt",
    ]);
  });

  it("loads with a clientId (getSurveyAndIsCompleted), saves partially, completes and posts; Studio lists the response", async () => {
    const target = await createSurvey();
    onTestFinished(() => removeSurvey(target.surveyId));
    const clientId = "v1-respondent@example.com";

    const model = new SurveyModel({ surveyId: FEEDBACK_ID, surveyPostId: target.postId, clientId });
    await loaded(model);
    expect(model.state).toBe("running");

    model.setValue("satisfaction", 2);
    const partial = sent(model);
    model.sendResult(target.postId, clientId, true);
    expect((await partial).success).toBe(true);
    expect(await listResults(target.surveyId)).toMatchObject([
      { data: { satisfaction: 2 }, clientId, partial: true },
    ]);

    model.setValue("satisfaction", 4);
    const complete = sent(model);
    model.doComplete();
    expect((await complete).success).toBe(true);
    const stored = await listResults(target.surveyId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ data: { satisfaction: 4 }, clientId });
    expect(stored[0]?.partial).toBeUndefined();

    // The same respondent opening the survey again is told it was completed.
    const again = new SurveyModel({ surveyId: target.surveyId, clientId });
    await loaded(again);
    // v1 shows "completedbefore" when getSurveyAndIsCompleted answers "completed".
    expect(again.state).toBe("completedbefore");
  });

  it("uploads a file to the post (upload) and stores the answered name", async () => {
    const target = await createSurvey();
    onTestFinished(() => removeSurvey(target.surveyId));
    const model = new SurveyModel({ surveyId: FEEDBACK_ID, surveyPostId: target.postId });
    await loaded(model);
    const question = model.getQuestionByName("receipt") as QuestionFileModel;
    const file = new File([new Uint8Array(PNG)], "receipt.png", { type: "image/png" });
    // Without an onUploadFiles handler v1 first reports a text error ("add a handler"), then, with
    // surveyPostId, uploads to the service; the service's outcome is the one that counts.
    const uploaded = await new Promise<{ status: string; data: unknown }>((resolve) => {
      model.uploadFiles(question, "receipt", [file], (status, data) => {
        if (status === "success" || (status === "error" && typeof data === "object")) {
          resolve({ status, data });
        }
      });
    });
    expect(uploaded, JSON.stringify(uploaded.data)).toMatchObject({ status: "success" });
    const [first] = uploaded.data as { content: string }[];
    expect(first?.content).toMatch(/^dxsimage:[0-9a-f]{64}\.png$/);

    // The answered name reads the image back through image?filePath= (prefix removed).
    const name = (first?.content ?? "").slice("dxsimage:".length);
    const image = await fetch(`${BASE_URL}/public/v1/Survey/image?filePath=${name}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
  });
});
