import { describe, expect, it } from "vitest";
import { formatListDate } from "./formatDate";

describe("formatListDate", () => {
  it("prints the US short date", () => {
    expect(formatListDate("2026-04-14T15:30:00.000Z", "UTC")).toBe("4/14/2026");
  });

  it("uses the given time zone", () => {
    expect(formatListDate("2026-04-14T00:30:00.000Z", "UTC")).toBe("4/14/2026");
    expect(formatListDate("2026-04-14T00:30:00.000Z", "America/Los_Angeles")).toBe("4/13/2026");
  });
});
