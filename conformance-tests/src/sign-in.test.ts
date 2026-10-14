import { describe, expect, it } from "vitest";
import { CookieJar } from "./sign-in.js";

const withCookies = (...cookies: string[]) => {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { headers });
};

describe("CookieJar", () => {
  it("keeps set cookies and drops those cleared with Max-Age=0", () => {
    const jar = new CookieJar();
    jar.store(withCookies("a=1; Path=/; HttpOnly", "b=2; Path=/api; Max-Age=600"));
    expect(jar.header()).toBe("a=1; b=2");
    jar.store(withCookies("a=; Path=/; Max-Age=0", "b=3"));
    expect(jar.get("a")).toBeUndefined();
    expect(jar.header()).toBe("b=3");
  });
});
