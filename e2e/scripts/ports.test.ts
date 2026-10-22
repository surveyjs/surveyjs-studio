import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { functionalPorts, usesAzuriteConfig, visualPorts } from "../ports.mjs";
import { busyMessage, checkPorts, describeCommandLine } from "./ports.mjs";

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
    expect(busyMessage({ port: taken, owner: "node server.js" })).toBe(
      `Port ${taken} is in use by node server.js. Stop it and run again.`,
    );
    expect(busyMessage({ port: taken, owner: null })).toBe(
      `Port ${taken} is in use by another process. Stop it and run again.`,
    );
  });

  it("finds the owner of the listener when the platform tells", async () => {
    const taken = await listen("127.0.0.1");
    const [busy] = await checkPorts([taken]);
    expect(busy?.owner === null || typeof busy?.owner === "string").toBe(true);
    if (busy?.owner) expect(busy.owner).toMatch(/node|vitest|PID \d+/i);
  });

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

describe("describeCommandLine", () => {
  it("hides credentials and shortens a long line", () => {
    expect(describeCommandLine("node x.js --conn Password=hunter2;Server=a")).toBe(
      "node x.js --conn Password=***;Server=a",
    );
    expect(describeCommandLine("x".repeat(300))).toHaveLength(200);
  });
});

describe("the ports of each configuration", () => {
  it("follow the configuration being run", () => {
    expect(functionalPorts({ image: false, azurite: false })).toEqual([3000, 3001, 5173, 5174]);
    expect(functionalPorts({ image: true, azurite: false })).toEqual([5173, 5174]);
    expect(functionalPorts({ image: false, azurite: true })).toEqual([3000, 5173]);
    expect(functionalPorts({ image: true, azurite: true })).toEqual([5173]);
    expect(visualPorts).toEqual([3002, 5175]);
  });

  it("detects the Azurite config in the arguments", () => {
    expect(usesAzuriteConfig(["--config", "playwright.azurite.config.ts"])).toBe(true);
    expect(usesAzuriteConfig(["--config=./playwright.azurite.config.ts"])).toBe(true);
    expect(usesAzuriteConfig(["--project=chromium", "tests/home.spec.ts"])).toBe(false);
  });
});
