import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM JavaScript, run by node without a compile step
import { waitForVersion } from "./wait-for-version.mjs";

type Answer = { commit: string } | Error;

// A fake clock: sleep moves it, so no real timer runs.
function setup(answers: Answer[]) {
  let time = 0;
  let polls = 0;
  return {
    get polls() {
      return polls;
    },
    run: (commit: string, timeoutMs = 60_000) =>
      waitForVersion({
        url: "https://example.test",
        commit,
        timeoutMs,
        intervalMs: 15_000,
        fetchJson: async (url: string) => {
          expect(url).toBe("https://example.test/version.json");
          const answer = answers[Math.min(polls++, answers.length - 1)];
          if (answer instanceof Error) throw answer;
          return answer;
        },
        now: () => time,
        sleep: async (ms: number) => {
          time += ms;
        },
      }),
  };
}

describe("waitForVersion", () => {
  it("resolves on the third poll when the commit appears then", async () => {
    const t = setup([{ commit: "old" }, { commit: "old" }, { commit: "new" }]);
    await t.run("new");
    expect(t.polls).toBe(3);
  });

  it("tolerates fetch errors and other commits in between", async () => {
    const t = setup([
      new Error("HTTP 502"),
      { commit: "old" },
      new Error("boom"),
      { commit: "new" },
    ]);
    await t.run("new");
    expect(t.polls).toBe(4);
  });

  it("rejects naming the expected and the last seen commit, after 5 polls at most", async () => {
    const t = setup([{ commit: "old" }]);
    await expect(t.run("new")).rejects.toThrow(/new[\s\S]*old|old[\s\S]*new/);
    expect(t.polls).toBeLessThanOrEqual(5);
  });

  it("rejects with the last error's message when every fetch fails", async () => {
    const t = setup([new Error("first"), new Error("connection refused")]);
    await expect(t.run("new")).rejects.toThrow("connection refused");
  });
});
