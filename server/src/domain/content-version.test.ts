import { describe, expect, it } from "vitest";
import { contentVersion } from "./content-version.js";

describe("contentVersion", () => {
  it("hashes the empty text to the known SHA-256 in base64url", () => {
    expect(contentVersion("")).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });

  it("is 43 characters of the base64url alphabet", () => {
    for (const text of ["", "{}", '{"title":"a"}', "Ünïcode ✓"]) {
      expect(contentVersion(text)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("differs for different texts and repeats for the same text", () => {
    expect(contentVersion("{}")).not.toBe(contentVersion("{ }"));
    expect(contentVersion("{}")).toBe(contentVersion("{}"));
  });

  it("hashes the UTF-8 bytes of non-ASCII text", () => {
    // SHA-256 of the two UTF-8 bytes C3 A9, base64url.
    expect(contentVersion("é")).toBe("SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw_biumnEw");
    expect(contentVersion("é")).not.toBe(contentVersion("e"));
  });
});
