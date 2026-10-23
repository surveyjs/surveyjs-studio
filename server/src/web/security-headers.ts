/**
 * The security headers of the web app's pages (ADR 0019). The server applies them when `WEB_ROOT`
 * is set (ADR 0021), `vite preview` through the plugin in web/vite.config.ts, and another static
 * host must send the same values (docs/operations.md). Scripts come only from the app's origin;
 * images, media, data (`choicesByUrl`) and frames of a survey may come from any https site.
 */
export interface SecurityHeaderOptions {
  /** The site is served over HTTPS: adds HSTS. */
  readonly https: boolean;
}

const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
] as const;

/** The run page may be framed by any site (a hosted survey embeds as an iframe of its run URL); no other page. */
export function frameAncestors(pathname: string): string {
  return pathname.startsWith("/s/") ? "*" : "'none'";
}

export function contentSecurityPolicy(pathname: string): string {
  return [...DIRECTIVES, `frame-ancestors ${frameAncestors(pathname)}`].join("; ");
}

export function securityHeaders(
  pathname: string,
  options: SecurityHeaderOptions,
): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(pathname),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    ...(options.https && { "Strict-Transport-Security": "max-age=31536000" }),
  };
}
