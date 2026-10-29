import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { functionalPorts, usesAzuriteConfig, usesSqlConfig, visualPorts } from "../ports.mjs";
import { busyMessage, checkPorts } from "./ports.mjs";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

function listen(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    servers.push(server);
    server.once("error", reject);
    server.listen(0, host, () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

/** A port that nothing listens on: bound, then released. */
async function freePort(): Promise<number> {
  const port = await listen("127.0.0.1");
  await new Promise((done) => servers.pop()?.close(done));
  return port;
}

describe("checkPorts", () => {
  it("names a port with a real listener on it and leaves a free port out", async () => {
    const taken = await listen("127.0.0.1");
    const free = await freePort();
    const busy = await checkPorts([taken, free]);
    expect(busy.map((b) => b.port)).toEqual([taken]);
    expect(busyMessage({ port: taken, owner: "node (PID 1)" })).toBe(
      `Port ${taken} is in use by node (PID 1). Stop it and run again.`,
    );
    expect(busyMessage({ port: taken, owner: null })).toBe(
      `Port ${taken} is in use. Stop it and run again.`,
    );
  });

  it("names the PID and the program of a listener, and nothing of its arguments", async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `require("net").createServer().listen(${port},"127.0.0.1",()=>console.log("up"));setTimeout(()=>process.exit(0),60000)`,
        "--",
        "--password",
        "canary-secret",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      await new Promise((ready) => child.stdout.once("data", ready));
      const [busy] = await checkPorts([port]);
      // Lookup is supported on Windows, Linux and macOS (netstat, lsof); null would hide a break.
      expect(busy?.owner).not.toBeNull();
      expect(busy?.owner).toMatch(/^\S.* \(PID \d+\)$|^PID \d+$/);
      expect(busy?.owner).toContain(String(child.pid));
      const message = busyMessage(busy as { port: number; owner: string | null });
      expect(message).toBe(`Port ${port} is in use by ${busy?.owner}. Stop it and run again.`);
      expect(message).not.toMatch(/canary|password|-e |createServer/i);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("sees a listener on the IPv6 loopback too", async () => {
    let taken: number;
    try {
      taken = await listen("::1");
    } catch {
      return; // no IPv6 loopback here
    }
    expect((await checkPorts([taken])).map((b) => b.port)).toEqual([taken]);
  });

  it("is empty when every port is free", async () => {
    expect(await checkPorts([await freePort()])).toEqual([]);
  });
});

describe("the ports of each configuration", () => {
  it("follow the configuration being run", () => {
    expect(functionalPorts({ image: false, azurite: false })).toEqual([3000, 3001, 5173, 5174]);
    expect(functionalPorts({ image: true, azurite: false })).toEqual([5173, 5174]);
    expect(functionalPorts({ image: false, azurite: true })).toEqual([3000, 5173]);
    expect(functionalPorts({ image: true, azurite: true })).toEqual([5173]);
    expect(functionalPorts({ image: false, azurite: false, sql: true })).toEqual([3000, 5173]);
    expect(visualPorts).toEqual([3002, 5175]);
  });

  it("detects the Azurite config in the arguments", () => {
    expect(usesAzuriteConfig(["--config", "playwright.azurite.config.ts"])).toBe(true);
    expect(usesAzuriteConfig(["--config=./playwright.azurite.config.ts"])).toBe(true);
    expect(usesAzuriteConfig(["--project=chromium", "tests/home.spec.ts"])).toBe(false);
  });

  it("detects the SQL configs in the arguments", () => {
    expect(usesSqlConfig(["--config", "playwright.sqlite.config.ts"])).toBe(true);
    expect(usesSqlConfig(["--config=e2e\\playwright.postgres.config.ts"])).toBe(true);
    expect(usesSqlConfig(["--config", "playwright.powered-by.config.ts"])).toBe(true);
    expect(usesSqlConfig(["--config", "playwright.password.config.ts"])).toBe(true);
    expect(usesSqlConfig(["--config", "playwright.azurite.config.ts"])).toBe(false);
    expect(usesSqlConfig(["playwrightXsqliteXconfig.ts"])).toBe(false);
  });
});
