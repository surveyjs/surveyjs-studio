import { describe, expect, it } from "vitest";
import { formatHistoryTime, formatListDate } from "./formatDate";

describe("formatListDate", () => {
  it("prints the US short date", () => {
    expect(formatListDate("2026-04-14T15:30:00.000Z", "UTC")).toBe("4/14/2026");
  });

  it("uses the given time zone", () => {
    expect(formatListDate("2026-04-14T00:30:00.000Z", "UTC")).toBe("4/14/2026");
    expect(formatListDate("2026-04-14T00:30:00.000Z", "America/Los_Angeles")).toBe("4/13/2026");
  });
});

describe("formatHistoryTime", () => {
  it("shows the date, the time and the zone", () => {
    expect(formatHistoryTime("2026-04-14T15:30:00.000Z", "UTC", "en-US")).toBe(
      "4/14/2026, 3:30 PM UTC",
    );
  });

  it("uses the given time zone", () => {
    expect(formatHistoryTime("2026-04-14T15:30:00.000Z", "America/Los_Angeles", "en-US")).toMatch(
      /^4\/14\/2026, 8:30 AM P[DS]T$/,
    );
  });
});
