// Test helpers: in-process HTTP stubs (Studio, the old service) and a raw client that can send
// any header, which `fetch` refuses for hop-by-hop names and `Host`.
import {
  request as httpRequest,
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildBridge, type BridgeDeps } from "../app.js";
import type { BridgeSettings } from "../settings.js";

export interface RecordedRequest {
  method: string;
  url: string;
  rawHeaders: string[];
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export interface Stub {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** An HTTP server on a free port; `handle` answers each request once its body has been read. */
export async function startStub(
  handle: (request: RecordedRequest, response: ServerResponse) => void,
): Promise<Stub> {
  const requests: RecordedRequest[] = [];
  // Room for the bridge's 32 KB of request headers.
  const server = createServer({ maxHeaderSize: 64 * 1024 }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        rawHeaders: req.rawHeaders,
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      handle(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface RawResponse {
  status: number;
  headers: IncomingMessage["headers"];
  rawHeaders: string[];
  body: Buffer;
}

/** Sends exactly these headers (pairs, in order) and body. */
export function send(
  url: string,
  options: { method?: string; headers?: [string, string][]; body?: Buffer | string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method ?? "GET", agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          body: Buffer.concat(chunks),
        }),
      );
      res.on("error", reject);
    });
    // Node's own Host header is replaced when the caller names one.
    for (const [name, value] of options.headers ?? []) {
      const existing = req.getHeader(name);
      if (existing !== undefined && name.toLowerCase() !== "host") {
        req.setHeader(name, [...[existing].flat().map(String), value]);
      } else {
        req.setHeader(name, value);
      }
    }
    req.on("error", reject);
    req.end(options.body);
  });
}

/** Header names of a raw header list, lower-cased. */
export function headerNames(rawHeaders: string[]): string[] {
  return rawHeaders.filter((_, index) => index % 2 === 0).map((name) => name.toLowerCase());
}

export const TEST_SETTINGS: Omit<BridgeSettings, "studioUrl" | "legacyUrl"> = {
  cacheEntries: 10,
  port: 0,
  host: "127.0.0.1",
  studioTimeoutMs: 2_000,
  fileTimeoutMs: 5_000,
  maxUploadBytes: 11_534_336,
  trustProxy: [],
  metricsPort: null,
  metricsHost: "127.0.0.1",
};

export interface RunningBridge {
  app: FastifyInstance;
  url: string;
  close(): Promise<void>;
}

/**
 * Builds the bridge, lets the test add routes, and listens on a free port. A test that adds its
 * own routes gets the bridge without the old API's actions (they would share route names).
 */
export async function startBridge(
  settings: Partial<BridgeSettings> & Pick<BridgeSettings, "studioUrl" | "legacyUrl">,
  register?: (app: FastifyInstance) => void,
  deps?: BridgeDeps,
): Promise<RunningBridge> {
  const app = buildBridge(
    { ...TEST_SETTINGS, ...settings },
    { actions: register === undefined, ...deps },
  );
  register?.(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** A URL nothing listens on: a port taken and released at once. */
export async function closedUrl(): Promise<string> {
  const stub = await startStub((_, res) => res.end());
  await stub.close();
  return stub.url;
}

/**
 * Writes `text` as it is to the bridge's socket and resolves with everything read until the
 * connection closes, or after `waitMs` (`timedOut` then).
 */
export function sendRaw(
  url: string,
  text: string,
  waitMs = 3_000,
): Promise<{ data: string; timedOut: boolean }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect(Number(port), hostname);
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ data, timedOut: true });
    }, waitMs);
    socket.on("data", (chunk: Buffer) => (data += chunk.toString("latin1")));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(timer);
      resolve({ data, timedOut: false });
    });
    socket.write(text);
  });
}
