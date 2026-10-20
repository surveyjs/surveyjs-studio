import type { BrowserContext } from "@playwright/test";
import { isLiveWrite, isTracker } from "../support/live-guard.js";

/**
 * Guards a context against any write to surveyjs.io. Trackers are aborted silently; a write that is
 * not on the read allow-list is aborted and recorded in the returned array (allow-listed POSTs and
 * every GET pass through). A test with a recorded write fails, so no baseline shows a failed save.
 */
export async function guardLiveContext(
  context: BrowserContext,
  allowHosts: readonly string[] = [],
): Promise<string[]> {
  const writes: string[] = [];
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    if (isTracker(url)) return route.abort();
    if (allowHosts.includes(new URL(url).hostname.toLowerCase())) return route.fallback();
    if (isLiveWrite(request.method(), url)) {
      writes.push(`${request.method()} ${url}`);
      return route.abort();
    }
    return route.fallback();
  });
  return writes;
}
