import { describe, expect, it } from "vitest";
import { errorLine, parseServeArgs, waitUntilReady } from "./serve.mjs";

describe("parseServeArgs", () => {
  it("serves on 8080 by default", () => {
    expect(parseServeArgs([])).toEqual({ stop: false, port: 8080 });
  });

  it("reads --port as --port value and --port=value", () => {
    expect(parseServeArgs(["--port", "9000"]).port).toBe(9000);
    expect(parseServeArgs(["--port=9001"]).port).toBe(9001);
  });

  it("reads --stop", () => {
    expect(parseServeArgs(["--stop"]).stop).toBe(true);
  });

  it.each([[["--port"]], [["--port", "x"]], [["--port=0"]], [["--port=70000"]], [["--bogus"]]])(
    "rejects %j",
    (args) => {
      expect(() => parseServeArgs(args)).toThrow();
    },
  );
});

describe("errorLine", () => {
  it("is the first line of a failed command's stderr", () => {
    const error = Object.assign(new Error("Command failed: docker run …\n  at x"), {
      stderr:
        "\ndocker: Error response from daemon: port is already allocated.\nSee 'docker run --help'.\n",
    });
    expect(errorLine(error)).toBe("docker: Error response from daemon: port is already allocated.");
  });

  it("says Docker is missing when the command is not found", () => {
    const error = Object.assign(new Error("spawnSync docker ENOENT"), { code: "ENOENT" });
    expect(errorLine(error)).toMatch(/Docker/);
  });

  it("is the first line of any other error's message", () => {
    expect(errorLine(new Error("first\n    at stack frame"))).toBe("first");
    expect(errorLine("plain")).toBe("plain");
  });
});

type Answer = "ok" | "refused" | string;

// A fake clock: sleep moves it, so no real timer runs.
function setup(answer: (url: string, round: number) => Answer) {
  let round = 0;
  const seen: string[] = [];
  return {
    seen,
    run: () =>
      waitUntilReady({
        port: 8080,
        attempts: 10,
        probe: async (url: string) => {
          seen.push(url);
          return answer(url, round);
        },
        sleep: async () => {
          round++;
        },
      }),
  };
}

describe("waitUntilReady", () => {
  it("asks for the shell, the worker and version.json on IPv4 and IPv6", async () => {
    const t = setup(() => "ok");
    await t.run();
    expect(new Set(t.seen)).toEqual(
      new Set(
        ["127.0.0.1", "[::1]"].flatMap((host) =>
          ["/", "/mockServiceWorker.js", "/version.json"].map((p) => `http://${host}:8080${p}`),
        ),
      ),
    );
  });

  it("needs two good rounds in a row", async () => {
    // Round 0 good, round 1 a reset (the proxy is up before nginx), then good.
    const t = setup((_, round) => (round === 1 ? "socket hang up" : "ok"));
    await t.run();
    expect(t.seen.length).toBe(4 * 6);
  });

  it("accepts an IPv6 address that refuses connections (no IPv6), not an IPv4 one", async () => {
    await setup((url) => (url.includes("[::1]") ? "refused" : "ok")).run();
    await expect(
      setup((url) => (url.includes("127.0.0.1") ? "refused" : "ok")).run(),
    ).rejects.toThrow(/127\.0\.0\.1.*refused/);
  });

  it("names the last failure when the host never gets ready", async () => {
    await expect(
      setup((url) => (url.endsWith("/version.json") ? "HTTP 404" : "ok")).run(),
    ).rejects.toThrow(/version\.json.*HTTP 404/);
  });
});
