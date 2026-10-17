import { describe, expect, it } from "vitest";
import { completedBeforeCookie } from "./cookie";

describe("completedBeforeCookie", () => {
  it("names the cookie the Form Library reads, for the run pages only, without expiry", () => {
    expect(completedBeforeCookie("11111111-0000-4000-8000-000000000001")).toBe(
      "11111111-0000-4000-8000-000000000001=true; path=/s; expires=Fri, 31 Dec 9999 23:59:59 GMT",
    );
  });

  it.each(["a;b", "a b", "a=b", "a,b", ""])("refuses the name %j", (name) => {
    expect(completedBeforeCookie(name)).toBeNull();
  });
});
