import { describe, expect, it } from "vitest";
import { rewriteFileIds } from "./rewrite.js";

const OLD_A = "a".repeat(64);
const NEW_A = "1".repeat(64);
const OLD_B = "b".repeat(64);
const NEW_B = "2".repeat(64);
const OTHER = "c".repeat(64);

describe("rewriteFileIds", () => {
  it("replaces every occurrence of each id and leaves the rest alone", () => {
    const text = JSON.stringify({
      logo: `https://x.test/api/v1/public/files/${OLD_A}`,
      pages: [{ image: `/api/v1/public/files/${OLD_B}`, again: OLD_A, other: OTHER }],
    });
    const ids = new Map([
      [OLD_A, NEW_A],
      [OLD_B, NEW_B],
    ]);
    expect(rewriteFileIds(text, ids)).toBe(
      JSON.stringify({
        logo: `https://x.test/api/v1/public/files/${NEW_A}`,
        pages: [{ image: `/api/v1/public/files/${NEW_B}`, again: NEW_A, other: OTHER }],
      }),
    );
  });

  it("returns the text unchanged for an empty map", () => {
    const text = `{"logo":"/api/v1/public/files/${OLD_A}"}`;
    expect(rewriteFileIds(text, new Map())).toBe(text);
  });
});
