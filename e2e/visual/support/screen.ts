/// <reference lib="dom" />
import { expect, type Locator, type Page } from "@playwright/test";
import {
  LIVE_ORIGIN,
  type Normalization,
  type Screen,
  type Side,
  type SideSpec,
} from "../manifest.js";
import { resolvePath, type VisualIds } from "./paths.js";

// Both sides call this module, so a screen is opened and prepared the same way on the live site and
// in the app. It only navigates, hovers and clicks: the live capture is read only.

/** Both sides keep the cookie consent here (`the site's page markup`, `CookieBanner.tsx`). */
const COOKIE_KEY = "isInformedAboutCookieAndPolicies";
/** The legacy editor starts its tour unless this is set (`the site's page markup`). The app has no tour. */
const TOUR_KEY = "isTourRejected";

const STEP_TIMEOUT = 30_000;

const FIXED_LOOK_CSS = "html { scrollbar-width: none } ::-webkit-scrollbar { display: none }";

function pickSelector(item: Normalization, side: Side): string {
  return item[side];
}

/** The `hide` rule of a screen's side, one declaration per selector. */
export function hideCss(spec: SideSpec): string {
  const rules = (spec.hide ?? []).map((item) => `${item.selector} { display: none !important }`);
  return [...rules, FIXED_LOOK_CSS].join("\n");
}

interface Check {
  readonly kind: string;
  readonly selector: string;
  readonly optional: boolean;
}

function checksOf(screen: Screen, side: Side): Check[] {
  const spec = screen[side];
  const checks: Check[] = [{ kind: "ready", selector: spec.ready, optional: false }];
  if (spec.target !== undefined)
    checks.push({ kind: "target", selector: spec.target, optional: false });
  for (const step of spec.steps ?? []) {
    const selector = "click" in step ? step.click : step.hover;
    checks.push({ kind: "step", selector, optional: false });
  }
  for (const item of spec.hide ?? []) {
    checks.push({ kind: "hide", selector: item.selector, optional: item.optional === true });
  }
  for (const item of spec.mask ?? []) {
    checks.push({ kind: "mask", selector: item.selector, optional: item.optional === true });
  }
  for (const item of screen.normalize ?? []) {
    checks.push({
      kind: "normalize",
      selector: pickSelector(item, side),
      optional: item.optional === true,
    });
  }
  return checks;
}

async function failIfUnmatched(page: Page, screen: Screen, side: Side): Promise<void> {
  const unmatched: string[] = [];
  for (const check of checksOf(screen, side)) {
    if (check.optional) continue;
    if ((await page.locator(check.selector).count()) === 0) {
      unmatched.push(`${check.kind} ${check.selector}`);
    }
  }
  if (unmatched.length > 0) {
    throw new Error(
      `Selectors matched nothing on ${side} for ${screen.id}: ${unmatched.join("; ")}`,
    );
  }
}

/**
 * Waits (within the step timeout) for every required hide, mask, normalization and target selector
 * to be attached. Parts of a page appear late (the live Embed tab shows "Loading..." until a request
 * returns). A selector that never appears is reported by `failIfUnmatched`, not here.
 */
async function waitForAdjustments(page: Page, screen: Screen, side: Side): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT;
  const selectors = checksOf(screen, side)
    .filter((check) => !check.optional && check.kind !== "ready" && check.kind !== "step")
    .map((check) => check.selector);
  for (const selector of new Set(selectors)) {
    const remaining = Math.max(deadline - Date.now(), 1);
    try {
      await page.locator(selector).first().waitFor({ state: "attached", timeout: remaining });
    } catch {
      // reported with every other missing selector by failIfUnmatched
    }
  }
}

/** Sets the text of every match now, and again whenever the page changes it back (React re-renders). */
async function normalizeTexts(
  page: Page,
  items: { selector: string; text: string }[],
): Promise<void> {
  if (items.length === 0) return;
  await page.evaluate((list) => {
    const apply = () => {
      for (const { selector, text } of list) {
        for (const element of document.querySelectorAll(selector)) {
          if (element.textContent !== text) element.textContent = text;
        }
      }
    };
    apply();
    new MutationObserver(apply).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, items);
}

/**
 * Opens and prepares a screen: consent and tour flags, navigation, the steps, the fixed look, the
 * normalized texts and the fonts. Returns the locator to shoot, or the page.
 */
export async function openScreen(
  page: Page,
  screen: Screen,
  side: Side,
  ids: VisualIds,
): Promise<Page | Locator> {
  const spec = screen[side];

  await page.addInitScript(
    (flags) => {
      try {
        if (flags.consent) localStorage.setItem(flags.cookieKey, "true");
        localStorage.setItem(flags.tourKey, "true");
        // The licence popups (the site's page markup) show only while these are unset; a
        // licensed account would otherwise get a 710x296 popup over the page.
        localStorage.setItem("expiredNotificationDateTime", "seen");
        localStorage.setItem("expiresSoonNotificationDateTime", "seen");
      } catch {
        // storage can be blocked; the screen then shows the banner or the tour
      }
    },
    { consent: screen.cookieBanner !== true, cookieKey: COOKIE_KEY, tourKey: TOUR_KEY },
  );

  const path = resolvePath(spec.path, ids);
  await page.goto(side === "live" ? `${LIVE_ORIGIN}${path}` : path);

  const visible = async (selector: string) => {
    const target = page.locator(selector).first();
    try {
      await target.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    } catch (error) {
      if ((await page.locator(selector).count()) === 0) {
        throw new Error(`Selectors matched nothing on ${side} for ${screen.id}: ${selector}`, {
          cause: error,
        });
      }
      throw error;
    }
    return target;
  };

  await visible(spec.ready);
  for (const step of spec.steps ?? []) {
    if ("click" in step) await (await visible(step.click)).click();
    else await (await visible(step.hover)).hover();
  }

  await waitForAdjustments(page, screen, side);

  await page.addStyleTag({ content: hideCss(spec) });
  await normalizeTexts(
    page,
    [...(screen.normalize ?? [])].map((item) => ({
      selector: pickSelector(item, side),
      text: item.text,
    })),
  );

  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => window.scrollTo(0, 0));

  await failIfUnmatched(page, screen, side);

  if (spec.target === undefined) return page;
  const target = page.locator(spec.target).first();
  await expect(target).toBeVisible();
  return target;
}

/** The `toHaveScreenshot` options of a screen's side; the capture and the tests use the same ones. */
export function screenshotOptions(page: Page, screen: Screen, side: Side) {
  return {
    mask: (screen[side].mask ?? []).map((item) => page.locator(item.selector)),
    maxDiffPixelRatio: screen.maxDiffPixelRatio,
    threshold: 0.2,
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    timeout: 20_000,
  };
}
