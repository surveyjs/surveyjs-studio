/** The surveyjs.io origin: the shell's navigation links point at the live site, as on the site. */
export const SITE_ORIGIN = "https://surveyjs.io";

/** The absolute surveyjs.io URL of a site path (`/pricing`); absolute URLs are returned as they are. */
export function siteUrl(url: string): string {
  return url.startsWith("/") ? SITE_ORIGIN + url : url;
}

/**
 * Whether the site opens the link in a new tab with the external-link icon: the site does that for
 * an absolute http(s) URL and keeps its own (relative) paths in the same tab.
 */
export function isExternal(url: string): boolean {
  return url.includes("https://") || url.includes("http://");
}

/** The address of My Surveys itself (the "My Surveys" button): this app's home page. */
export const MY_SURVEYS_URL = "/";
