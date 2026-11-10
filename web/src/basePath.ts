/**
 * The app's base path, without the trailing slash: `""` at the root of its host, `"/studio"` under a
 * sub-path. Vite's `base` sets it at build time; only the sandbox build can have one
 * (`SANDBOX_BASE`, scripts/sandbox-host/base-path.ts). The router's `basepath` is the same.
 */
export const BASE_PATH: string = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * An app path (`/s/abc`, as the router names pages) as the URL path the browser needs: under the
 * base path. Anything else, such as a full URL, `//host` or a relative path, is returned as it is.
 * For a plain `href`, `window.open` or `location.assign`; the router's own links add the base itself.
 */
export function underBase(path: string, basePath: string = BASE_PATH): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return path;
  return basePath + path;
}

/** The app's address without a trailing slash: the page's origin and the base path. */
export function appRootUrl(basePath: string = BASE_PATH): string {
  return window.location.origin + basePath;
}
