import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { newKey } from "./byte-store-suite.js";
import { createS3ByteStore } from "./s3.js";

describe("S3 byte store timeouts", () => {
  const servers: Server[] = [];
  const sockets: Socket[] = [];
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  });

  /** A server that accepts connections and never answers. */
  const silentServer = (): Promise<number> =>
    new Promise((resolve) => {
      const server = createServer((socket) => sockets.push(socket));
      servers.push(server);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });

  it("gives up on a server that never answers instead of waiting for it", async () => {
    const port = await silentServer();
    const store = createS3ByteStore(
      {
        bucket: "files",
        region: "us-east-1",
        endpoint: `http://127.0.0.1:${String(port)}`,
        forcePathStyle: true,
        credentials: { accessKeyId: "a", secretAccessKey: "b" },
      },
      { connectionTimeoutMs: 300, idleTimeoutMs: 300 },
    );
    const started = Date.now();
    const probe = await store.probe();
    expect(probe.ok).toBe(false);
    await expect(store.get(newKey())).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15_000);
});
