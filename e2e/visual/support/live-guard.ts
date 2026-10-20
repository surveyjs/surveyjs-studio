const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const TRACKER_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com",
  "redditstatic.com",
  "reddit.com",
  "ads-twitter.com",
  "analytics.twitter.com",
  "clarity.ms",
  "hotjar.com",
];

/**
 * A POST that only reads may be added here later. Each entry needs a comment that names the legacy
 * source line proving the request does not change anything.
 */
export const LIVE_READ_ALLOWLIST: readonly RegExp[] = [
  // Builds the example code of the editor's Embed Survey tab and returns it as JSON; no store write.
  // Without it the tab stays on "Loading...". Legacy proof: Controllers/the site's code.
  /^https:\/\/surveyjs\.io\/api\/CodeViewer\/getfiles(\?.*)?$/i,
  // The Renewals and Upgrades calculator on /manage computes dates on an in-memory order; nothing is
  // persisted. Legacy proof: Controllers/the site's code and the site's code.
  /^https:\/\/surveyjs\.io\/api\/cart\/calcprepare(\?.*)?$/i,
];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True for any method other than GET, HEAD or OPTIONS to `surveyjs.io` or a subdomain. */
export function isLiveWrite(method: string, url: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (method.toUpperCase() === "POST" && LIVE_READ_ALLOWLIST.some((allowed) => allowed.test(url)))
    return false;
  const host = hostOf(url);
  return host !== undefined && isHostOrSubdomain(host, "surveyjs.io");
}

/** True for the analytics and advertising hosts the live pages load; their requests are not the site's. */
export function isTracker(url: string): boolean {
  const host = hostOf(url);
  return host !== undefined && TRACKER_HOSTS.some((domain) => isHostOrSubdomain(host, domain));
}
