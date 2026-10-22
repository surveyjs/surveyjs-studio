import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  DEFAULT_STATES,
  FEEDBACK_DEFINITION,
  FEEDBACK_NAME,
  FEEDBACK_RESPONSES,
  PERSONAL_ACTIVE,
  PERSONAL_ARCHIVED,
  PROJECT_NAME,
  PROJECT_SURVEYS,
  VISUAL_USER,
  type VisualStates,
} from "../data-set.js";
import { putDefinitionViaApi } from "../../tests/support/editor.js";
import { createProjectViaApi } from "../../tests/support/projects.js";
import { submitViaApi } from "../../tests/support/results.js";
import { publishViaApi } from "../../tests/support/run.js";
import { signInAt } from "../../tests/support/sign-in.js";
import { csrfHeaders, createSurveyViaApi } from "../../tests/support/survey-list.js";
import { expect, test as setup } from "../../tests/support/test.js";

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = resolve(here, "../.state");
const statesPath = resolve(here, "../baselines/states.json");

/**
 * How many history entries the live survey has: from the capture's states, or the default for
 * `--self`. The capture refuses fewer than `HISTORY_SAVES` (states.test.ts checks the committed file).
 */
function historyEntries(): number {
  if (process.env["VISUAL_BASELINES"] === "self") return DEFAULT_STATES.historyEntries;
  return (JSON.parse(readFileSync(statesPath, "utf8")) as VisualStates).historyEntries;
}

async function patchSurvey(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  const response = await page.request.patch(`/api/v1/surveys/${id}`, {
    headers: { ...(await csrfHeaders(page)), "Content-Type": "application/merge-patch+json" },
    data: patch,
  });
  expect(response.status()).toBe(200);
}

async function historyCount(page: Page, surveyId: string): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  do {
    const next = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await page.request.get(`/api/v1/surveys/${surveyId}/history?limit=200${next}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items: unknown[]; nextCursor: string | null };
    count += body.items.length;
    cursor = body.nextCursor;
  } while (cursor !== null);
  return count;
}

setup("create the visual data set for the visual user", async ({ page }) => {
  setup.setTimeout(120_000);
  await signInAt(page, "/", VISUAL_USER);
  mkdirSync(stateDir, { recursive: true });
  await page.context().storageState({ path: resolve(stateDir, "erin.json") });

  // The order of creation, and the touch of `Customer feedback` last, give the lists their order.
  const project = await createProjectViaApi(page, PROJECT_NAME);
  for (const name of PROJECT_SURVEYS) await createSurveyViaApi(page, name, project.id);

  for (const name of PERSONAL_ARCHIVED) {
    const survey = await createSurveyViaApi(page, name);
    await patchSurvey(page, survey.id, { archived: true });
  }
  const [feedbackName, ...others] = PERSONAL_ACTIVE;
  expect(feedbackName).toBe(FEEDBACK_NAME);
  // PERSONAL_ACTIVE is in display order; the creation order is the reverse of the others.
  for (const name of [...others].reverse()) await createSurveyViaApi(page, name);
  const feedback = await createSurveyViaApi(page, FEEDBACK_NAME);

  // The same number of history entries as the live survey; the last save is the feedback definition,
  // so at least one save is needed (a new survey has fewer entries than the live one).
  const wanted = historyEntries();
  let count = await historyCount(page, feedback.id);
  expect(count, "a new survey has fewer history entries than the live one").toBeLessThan(wanted);
  while (count < wanted) {
    await putDefinitionViaApi(page, feedback.id, FEEDBACK_DEFINITION);
    count = await historyCount(page, feedback.id);
  }
  expect(count).toBe(wanted);
  const stored = await page.request.get(`/api/v1/surveys/${feedback.id}/definition`);
  expect(await stored.json()).toEqual(FEEDBACK_DEFINITION);

  await publishViaApi(page, feedback.id);
  for (const data of FEEDBACK_RESPONSES) await submitViaApi(page, feedback.id, data);
  // Last: this touch makes `Customer feedback` the newest survey of the list.
  await patchSurvey(page, feedback.id, { settings: { publicResults: true } });

  const list = await page.request.get("/api/v1/surveys?project=personal&archived=false&limit=50");
  expect(list.status()).toBe(200);
  const names = ((await list.json()) as { items: { name: string }[] }).items.map(
    (item) => item.name,
  );
  expect(names).toEqual([...PERSONAL_ACTIVE]);

  writeFileSync(
    resolve(stateDir, "app-ids.json"),
    JSON.stringify(
      { feedbackId: feedback.id, feedbackResultId: feedback.resultId, projectId: project.id },
      null,
      2,
    ),
  );
});
