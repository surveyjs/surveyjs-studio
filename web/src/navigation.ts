import { underBase } from "./basePath";

/**
 * Full-page navigation, behind a seam so tests can assert the target without touching jsdom's
 * location. An app path (`/sign-in`) goes under the base path (basePath.ts); a full URL is left as it is.
 */
export function navigateTo(url: string): void {
  window.location.assign(underBase(url));
}
