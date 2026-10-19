/** The API reference: Redoc needs its inline script, so its CSP only forbids framing (R18). */
const API_DOCS_PATH = "/api/docs";

/** R18: the headers every server answer gets unless its route set them already. Names in lower case. */
export function serverSecurityHeaders(
  url: string,
  options: { readonly https: boolean },
): Record<string, string> {
  const path = url.split("?", 1)[0] ?? url;
  return {
    "content-security-policy":
      path === API_DOCS_PATH
        ? "frame-ancestors 'none'"
        : "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    ...(options.https && { "strict-transport-security": "max-age=31536000" }),
  };
}
