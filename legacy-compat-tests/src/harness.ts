// The suite's harness: where the old API's host is (`BASE_URL`, the bridge), and a test per golden
// file, which sets up the state the case needs, replays its request and compares the answer after
// masking (the placeholders and comparison of src/golden.ts).
import { expect, inject, it } from "vitest";
import {
  compareAnswer,
  loadGoldens,
  readAnswer,
  requestInit,
  requestUrl,
  substitute,
  type Answer,
  type Golden,
  type GoldenRequest,
} from "./golden.js";
import { createSurvey, removeSurvey } from "./studio.js";

export { compareAnswer, matchesText, readAnswer } from "./golden.js";

/** The old API's host under test (the bridge), without a trailing slash. */
export const BASE_URL = inject("baseUrl");
/** Studio's API base URL, with `/api/v1`. */
export const STUDIO_URL = inject("studioUrl");
/** Studio's storage provider. */
export const PROVIDER = inject("provider");
/** The old-service stub the bridge forwards to; null against an external bridge. */
export const LEGACY_STUB_URL = inject("legacyStubUrl");

/** Sends a request to the old API's host and reads the whole answer. */
export async function send(request: GoldenRequest): Promise<Answer> {
  return readAnswer(await fetch(requestUrl(BASE_URL, request), requestInit(request)));
}

/** Sets up the case's state; returns its variables and the cleanup. */
async function prepare(
  golden: Golden,
): Promise<{ vars: Record<string, string>; cleanUp: () => Promise<void> }> {
  const setup = golden.setup;
  if (setup === undefined) return { vars: {}, cleanUp: () => Promise.resolve() };
  const survey = await createSurvey(setup.survey.settings);
  const vars: Record<string, string> = {
    "survey.surveyId": survey.surveyId,
    "survey.postId": survey.postId,
    "survey.resultId": survey.resultId,
  };
  const cleanUp = () => removeSurvey(survey.surveyId);
  try {
    for (const post of setup.posts ?? []) {
      const answer = await send({
        method: "POST",
        path: "/public/v1/Survey/post/",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { json: { postId: survey.postId, ...post } },
      });
      if (answer.status !== 200) throw new Error(`the setup post answered ${answer.status}`);
    }
    for (const upload of setup.uploads ?? []) {
      const answer = await send({
        method: "POST",
        path: "/public/v1/Survey/upload/",
        body: {
          multipart: [
            {
              name: "file",
              filename: upload.filename,
              contentType: upload.contentType,
              base64: upload.base64,
            },
            { name: "postId", value: survey.postId },
          ],
        },
      });
      if (answer.status !== 200) throw new Error(`the setup upload answered ${answer.status}`);
      const name = JSON.parse(answer.body.toString("utf8")) as string;
      vars[upload.as] = name;
      vars[`${upload.as}.name`] = name.slice(name.indexOf(":") + 1);
    }
  } catch (error) {
    await cleanUp();
    throw error;
  }
  return { vars, cleanUp };
}

/** One test per golden file of the actions; a case limited to other providers is skipped. */
export function goldenTests(actions: readonly string[]): void {
  for (const { name, golden } of loadGoldens(actions)) {
    const runs = golden.providers === undefined || golden.providers.includes(PROVIDER);
    it.skipIf(!runs)(`${name}: ${golden.description}`, async () => {
      const { vars, cleanUp } = await prepare(golden);
      try {
        const answer = await send(substitute(golden.request, vars));
        expect(compareAnswer(substitute(golden.response, vars), answer)).toEqual([]);
      } finally {
        await cleanUp();
      }
    });
  }
}
