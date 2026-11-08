import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../server/src/web/security-headers.js";

const dir = resolve(import.meta.dirname, "../../deploy/sandbox");
const headers = readFileSync(resolve(dir, "security-headers.conf"), "utf8");
const site = readFileSync(resolve(dir, "nginx.conf"), "utf8");

function cspValue(): string {
  const line = headers.split("\n").find((l) => l.includes("Content-Security-Policy"));
  const match = /add_header Content-Security-Policy "(.*)" always;/.exec(line ?? "");
  if (!match?.[1]) throw new Error("no Content-Security-Policy line");
  return match[1];
}

describe("security-headers.conf", () => {
  it("sends the server's policy for every page but the run page", () => {
    expect(cspValue().replace("$sandbox_frame_ancestors", "'none'")).toBe(
      contentSecurityPolicy("/"),
    );
  });

  it("lets any site frame the run page", () => {
    expect(cspValue().replace("$sandbox_frame_ancestors", "*")).toBe(contentSecurityPolicy("/s/x"));
  });

  it.each([
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Content-Type-Options", "nosniff"],
    ["Strict-Transport-Security", "max-age=31536000"],
  ])("sends %s always", (name, value) => {
    expect(headers).toContain(`add_header ${name} "${value}" always;`);
  });
});

describe("nginx.conf", () => {
  it("maps the run page to frame-ancestors *, the rest to 'none'", () => {
    expect(site).toContain("map $request_uri $sandbox_frame_ancestors");
    const squeezed = site.replace(/\s+/g, " ");
    expect(squeezed).toContain('~^/s/ "*";');
    expect(squeezed).toContain(`default "'none'";`);
  });

  it("includes the headers file in every location", () => {
    const locations = site.match(/location [^{]+\{[^}]*\}/g) ?? [];
    expect(locations.length).toBeGreaterThan(0);
    for (const location of locations) {
      expect(location).toContain("include /etc/nginx/sandbox/security-headers.conf;");
    }
  });
});
