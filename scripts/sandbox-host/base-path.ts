// The sandbox build's base path: where on its host the site lives (`SANDBOX_BASE`, `/` by default).
// Vite's `base` takes it, so it is fixed at build time. Only Node built-ins: see version-file.ts.

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * `SANDBOX_BASE` as Vite's `base`: `/` when unset or empty, else a path with one leading and one
 * trailing slash (`studio`, `/studio` and `/studio/` all give `/studio/`). Throws for anything that
 * is not a plain path: a URL, `//`, `.` or `..` segments, or characters a URL would escape.
 */
export function sandboxBase(env: NodeJS.ProcessEnv): string {
  const raw = (env["SANDBOX_BASE"] ?? "").trim();
  if (raw === "" || raw === "/") return "/";
  const segments = raw.replace(/^\/|\/$/g, "").split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") {
      throw new Error(
        `SANDBOX_BASE must be a path such as /studio/ (letters, digits, . _ ~ -): ${JSON.stringify(raw)}`,
      );
    }
  }
  return `/${segments.join("/")}/`;
}
