import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { startUserApiStub, stubDataFromFixtures } from "../users/surveyjs-api/stub.js";
import { createProviders } from "./index.js";

const TOKEN = "readiness-token";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function readyzWith(url: string, token = TOKEN) {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    USER_DIRECTORY: "surveyjs-api",
    USER_API_URL: url,
    USER_API_TOKEN: token,
  });
  const providers = await createProviders(config);
  const app = await buildApp(config, providers);
  closers.push(() => app.close());
  return app.inject("/readyz");
}

async function answering(status: number): Promise<string> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(status).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("/readyz with the user API", () => {
  it("is ok while the stub answers", async () => {
    const stub = await startUserApiStub({
      data: await stubDataFromFixtures(),
      token: TOKEN,
      port: 0,
    });
    closers.push(() => stub.close());
    const res = await readyzWith(stub.url);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("names user-api when the API answers 500", async () => {
    const res = await readyzWith(await answering(500));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable", failing: ["user-api"] });
  });

  it("names user-api when the token is refused", async () => {
    const stub = await startUserApiStub({
      data: await stubDataFromFixtures(),
      token: TOKEN,
      port: 0,
    });
    closers.push(() => stub.close());
    const res = await readyzWith(stub.url, "another-token");
    expect(res.json()).toEqual({ status: "unavailable", failing: ["user-api"] });
  });

  it("names user-api when the API is down", async () => {
    const stub = await startUserApiStub({
      data: await stubDataFromFixtures(),
      token: TOKEN,
      port: 0,
    });
    const url = stub.url;
    await stub.close();
    const res = await readyzWith(url);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable", failing: ["user-api"] });
  });
});
