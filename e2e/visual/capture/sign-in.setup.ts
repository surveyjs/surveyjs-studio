import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { LIVE_ORIGIN } from "../manifest.js";
import { guardLiveContext } from "./route-guard.js";
import { checklistText } from "../support/checklist.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATE = resolve(here, "../.auth/surveyjs-io.json");
const MY_SURVEYS = ".v2-class---my-surveys-page";
const SIGN_IN_WAIT = 10 * 60_000;

// The person signs in; this code never types into a field. The state goes to the git-ignored
// visual/.auth/ folder and the runner deletes it at the end.
test("sign in to surveyjs.io", async ({ browser }, testInfo) => {
  if (testInfo.project.name === "signin-chromium") console.log(checklistText());

  const reuse = existsSync(STATE);
  const context = await browser.newContext(reuse ? { storageState: STATE } : {});
  // A fresh sign-in is unguarded: the person's own login posts to the site. A reused state needs no
  // login, so every write is blocked except to the auth host (a stale state sends the person there).
  if (reuse) await guardLiveContext(context, ["auth.surveyjs.io"]);
  const page = await context.newPage();
  await page.goto(`${LIVE_ORIGIN}/Service/MySurveys/personal?type=list`);

  const shown = await page
    .locator(MY_SURVEYS)
    .first()
    .waitFor({ state: "visible", timeout: reuse ? 20_000 : 1 })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    console.log(
      "Sign in to surveyjs.io in the browser window (the dedicated visual account). Waiting up to 10 minutes…",
    );
  }
  await expect(page.locator(MY_SURVEYS).first()).toBeVisible({ timeout: SIGN_IN_WAIT });

  mkdirSync(dirname(STATE), { recursive: true });
  await context.storageState({ path: STATE });
  await context.close();
});
