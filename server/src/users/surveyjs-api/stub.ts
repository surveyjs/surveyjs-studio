import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { User } from "../../domain/types.js";
import { readLegacyFixtures } from "../../providers/azure-legacy/fixtures.js";
import { licenceExpiriesFromLegacy, userFromLegacy } from "../../providers/azure-legacy/mapping.js";
import type { LegacyLicenceRow } from "../../providers/azure-legacy/rows.js";

/**
 * A stand-in for the surveyjs.io user API (R9), for tests and local runs. It serves the data it is
 * given and checks the bearer token, nothing else. Never a real host.
 */
export interface UserApiStubData {
  readonly users: readonly User[];
  /** ISO expiry (or null) of each licence, by lower-case user id; a known user without licences has []. */
  readonly licences: Readonly<Record<string, readonly (string | null)[]>>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_LOOKUP = 100;
const MAX_BODY_BYTES = 1_000_000;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asDate = (value: unknown): Date | null => {
  const text = asString(value);
  return text === null ? null : new Date(text);
};

/**
 * The legacy fixtures' users (through the legacy mapping) and their licences: the owned rows with
 * a developer seat taking its parent's date, then the licences transferred to the user.
 */
export async function stubDataFromFixtures(dir?: string): Promise<UserApiStubData> {
  const fixtures = await readLegacyFixtures(dir);
  const licences = fixtures.rawSqlRows.UserLicenses ?? [];
  const transfers = fixtures.rawSqlRows.LicenseTransfers ?? [];
  const byId = new Map(licences.map((row) => [String(row.id).toLowerCase(), row]));
  const users = fixtures.users.map(userFromLegacy);
  const result: Record<string, readonly (string | null)[]> = {};
  for (const user of users) {
    const rows: LegacyLicenceRow[] = [];
    for (const row of licences) {
      if (String(row.userid).toLowerCase() !== user.id) continue;
      const parentId = asString(row.parentlicenseid);
      const parent = parentId === null ? undefined : byId.get(parentId.toLowerCase());
      rows.push({
        id: String(row.id),
        expirationdate: asDate(row.expirationdate),
        parentlicenseid: parentId,
        parentid: parent === undefined ? null : String(parent.id),
        parentexpirationdate: parent === undefined ? null : asDate(parent.expirationdate),
      });
    }
    for (const row of transfers) {
      if (String(row.userid).toLowerCase() !== user.id) continue;
      const licence = byId.get(String(row.licenseid).toLowerCase());
      rows.push({
        id: String(row.id),
        expirationdate: licence === undefined ? null : asDate(licence.expirationdate),
        parentlicenseid: null,
        parentid: null,
        parentexpirationdate: null,
      });
    }
    result[user.id] = licenceExpiriesFromLegacy(rows).map((at) => at?.toISOString() ?? null);
  }
  return { users, licences: result };
}

export interface UserApiStub {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const serialize = (user: User) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  blocked: user.blocked,
});

/** The parsed JSON body, or undefined when it is too large or not JSON. */
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY_BYTES) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        resolve(undefined);
      }
    });
    request.on("error", () => resolve(undefined));
  });
}

/** Listens on a loopback host only (127.0.0.1 default, localhost, ::1); port 0 picks a free one. */
export async function startUserApiStub(options: {
  readonly data: UserApiStubData;
  readonly token: string;
  readonly host?: string;
  readonly port?: number;
}): Promise<UserApiStub> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      "The user API stub listens on a loopback host only (127.0.0.1, localhost, ::1)",
    );
  }
  const byId = new Map(options.data.users.map((user) => [user.id.toLowerCase(), user]));
  const byEmail = new Map(options.data.users.map((user) => [user.email.toLowerCase(), user]));
  const expected = `Bearer ${options.token}`;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://stub.invalid").pathname;
    if (method === "GET" && path === "/healthz") return send(response, 200, { status: "ok" });
    if (!path.startsWith("/users/")) return send(response, 404, { error: "not found" });
    if (request.headers.authorization !== expected) {
      return send(response, 401, { error: "unauthorized" });
    }
    if (method === "POST" && path === "/users/by-email") {
      const body = await readJson(request);
      const email = (body as { email?: unknown } | null | undefined)?.email;
      if (typeof email !== "string") return send(response, 400, { error: "bad request" });
      const user = byEmail.get(email.toLowerCase());
      return user
        ? send(response, 200, serialize(user))
        : send(response, 404, { error: "not found" });
    }
    if (method === "POST" && path === "/users/lookup") {
      const body = await readJson(request);
      const ids = (body as { ids?: unknown } | null | undefined)?.ids;
      if (
        !Array.isArray(ids) ||
        ids.length > MAX_LOOKUP ||
        !ids.every((id) => typeof id === "string")
      ) {
        return send(response, 400, { error: "bad request" });
      }
      const users = (ids as string[]).flatMap((id) => byId.get(id.toLowerCase()) ?? []);
      return send(response, 200, { users: users.map(serialize) });
    }
    const match = /^\/users\/([^/]+)(\/licences)?$/.exec(path);
    if (method === "GET" && match) {
      const id = match[1]!.toLowerCase();
      const user = byId.get(id);
      if (!user) return send(response, 404, { error: "not found" });
      if (match[2] === undefined) return send(response, 200, serialize(user));
      const licences = (options.data.licences[id] ?? []).map((expiresAt) => ({ expiresAt }));
      return send(response, 200, { licences });
    }
    return send(response, 404, { error: "not found" });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, { error: "internal error" });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  const shown = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${shown}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
