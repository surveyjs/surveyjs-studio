import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const SURVEY_ID = "22222222-0000-4000-8000-a00000000001";

describe("the web app's security headers", () => {
  it("lets scripts come only from the app's origin and forbids framing a private page", () => {
    const policy = contentSecurityPolicy("/");
    expect(policy).toMatch(/; frame-ancestors 'none'$/);
    expect(policy.split("; ")).toContain("script-src 'self'");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("lets any site frame the run page", () => {
    expect(contentSecurityPolicy(`/s/${SURVEY_ID}`)).toMatch(/; frame-ancestors \*$/);
  });

  it.each([`/results/${SURVEY_ID}`, `/surveys/${SURVEY_ID}/edit`])(
    "forbids framing %s",
    (pathname) => {
      expect(contentSecurityPolicy(pathname)).toMatch(/; frame-ancestors 'none'$/);
    },
  );

  it("sends the four headers over https, HSTS only there", () => {
    expect(Object.keys(securityHeaders("/", { https: true }))).toStrictEqual([
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Strict-Transport-Security",
    ]);
    expect(securityHeaders("/", { https: true })).toMatchObject({
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000",
    });
    expect(securityHeaders("/", { https: false })).not.toHaveProperty("Strict-Transport-Security");
  });
});
