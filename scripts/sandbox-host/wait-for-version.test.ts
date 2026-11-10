import { describe, expect, it } from "vitest";
import { parseWaitArgs, waitForVersion } from "./wait-for-version.mjs";

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

  it("names the last commit seen even when the final poll errored", async () => {
    const t = setup([{ commit: "old" }, new Error("HTTP 502")]);
    await expect(t.run("new")).rejects.toThrow(/last commit seen: old.*last error: HTTP 502/);
  });
});

describe("parseWaitArgs", () => {
  const base = ["--url", "https://example.test", "--commit", "abc"];

  it("reads the arguments, with the defaults of 30 minutes and 15 seconds", () => {
    expect(parseWaitArgs(base)).toEqual({
      url: "https://example.test",
      commit: "abc",
      timeoutMs: 30 * 60_000,
      intervalMs: 15_000,
    });
    expect(parseWaitArgs([...base, "--timeout-min", "1", "--interval-s", "5"])).toMatchObject({
      timeoutMs: 60_000,
      intervalMs: 5_000,
    });
  });

  it("reads --flag=value as well as --flag value", () => {
    expect(
      parseWaitArgs([
        "--url=https://example.test",
        "--commit",
        "abc",
        "--timeout-min=2",
        "--interval-s=5",
      ]),
    ).toEqual({
      url: "https://example.test",
      commit: "abc",
      timeoutMs: 2 * 60_000,
      intervalMs: 5_000,
    });
  });

  it("keeps an = inside the value", () => {
    expect(parseWaitArgs(["--url=https://example.test/?a=b", "--commit=abc"]).url).toBe(
      "https://example.test/?a=b",
    );
  });

  it("trims the commit", () => {
    expect(parseWaitArgs(["--url", "https://example.test", "--commit", " abc\n"]).commit).toBe(
      "abc",
    );
  });

  it.each([
    [["--timeout-min="]],
    [["--bogus=1"]],
    [["--timeout-min", "abc"]],
    [["--timeout-min", "0"]],
    [["--interval-s", "-5"]],
    [["--interval-s", "Infinity"]],
    [["--timeout-min"]],
    [["--timeout-min", "--interval-s", "5"]],
    [["--bogus", "1"]],
  ])("rejects %j", (extra) => {
    expect(() => parseWaitArgs([...base, ...extra])).toThrow();
  });

  it("requires the url and the commit", () => {
    expect(() => parseWaitArgs(["--url", "https://example.test"])).toThrow(/required/);
  });
});
