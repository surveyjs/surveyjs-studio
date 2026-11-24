import { describe, expect, it } from "vitest";
import { createPacer } from "./pace.js";

/** A clock that only moves when the pacer sleeps; records each sleep. */
function fakeClock() {
  let now = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => (now += ms),
  };
}

describe("createPacer", () => {
  it("spaces each class's requests 60 000 / perMinute ms apart, the first one at once", async () => {
    const clock = fakeClock();
    const pace = createPacer({ public: 60, file: 600, summary: 10 }, clock);
    await pace("summary");
    await pace("summary");
    await pace("summary");
    expect(clock.sleeps).toEqual([6000, 6000]);
  });

  it("keeps the classes apart, and does not wait for an action without a limit", async () => {
    const clock = fakeClock();
    const pace = createPacer({ public: 60, file: 600, summary: 10 }, clock);
    await pace("public");
    await pace("file");
    await pace(null);
    await pace(null);
    await pace("file");
    await pace("public");
    expect(clock.sleeps).toEqual([100, 900]);
  });

  it("does not wait when the spacing has already passed", async () => {
    const clock = fakeClock();
    const pace = createPacer({ public: 60, file: 600, summary: 10 }, clock);
    await pace("public");
    clock.advance(1500);
    await pace("public");
    expect(clock.sleeps).toEqual([]);
  });

  it("refuses a limit that is not a positive number", () => {
    expect(() => createPacer({ public: 0, file: 600, summary: 10 })).toThrow(/public/);
    expect(() => createPacer({ public: 60, file: Number.NaN, summary: 10 })).toThrow(/file/);
  });
});
