import type { BrowserContext } from "@playwright/test";
import { isLiveWrite, isTracker } from "../support/live-guard.js";

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Guards a context against any write, to surveyjs.io or to any other host. Trackers are aborted
 * silently; a request with a method other than GET, HEAD or OPTIONS that is not on the read
 * allow-list is aborted and recorded in the returned array (allow-listed POSTs and every GET pass
 * through). A test with a recorded write fails, so no baseline shows a failed save. `allowHosts`
 * lets every request to those hosts through (the reused sign-in state's auth host).
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
    const host = hostname(url);
    if (host !== undefined && allowHosts.includes(host)) return route.fallback();
    if (isLiveWrite(request.method(), url)) {
      writes.push(`${request.method()} ${url}`);
      return route.abort();
    }
    return route.fallback();
  });
  return writes;
}
