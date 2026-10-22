import {
  devices,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
} from "@playwright/test";

/** The capture and the comparison render at this size; the site header shows the account name from 1440. */
export const VIEWPORT = { width: 1440, height: 900 } as const;

type Use = PlaywrightWorkerOptions & PlaywrightTestOptions;

const COMMON = {
  viewport: { ...VIEWPORT },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
  reducedMotion: "reduce",
} as const;

/** The Playwright projects both visual configs use, so they cannot drift apart. */
export const VISUAL_PROJECTS: readonly { name: string; use: Partial<Use> }[] = [
  { name: "chromium", use: { ...devices["Desktop Chrome"], ...COMMON } },
  { name: "firefox", use: { ...devices["Desktop Firefox"], ...COMMON } },
  { name: "webkit", use: { ...devices["Desktop Safari"], ...COMMON } },
];
