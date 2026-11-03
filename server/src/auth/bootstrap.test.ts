import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createMemoryLocalAccounts } from "../providers/memory-accounts.js";
import type { NewLocalAccount } from "../providers/types.js";
import { bootstrapFirstAdmin } from "./bootstrap.js";

const NOW = Date.parse("2026-11-03T10:00:00.000Z");

/** An instance whose only sign-in is GitHub, with the first admin's email. */
const oauthOnly = (extra: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: "test",
    USER_DIRECTORY: "local",
    AUTH_METHODS: "github",
    GITHUB_CLIENT_ID: "gh-client",
    GITHUB_CLIENT_SECRET: "stub-secret-github",
    ADMIN_EMAIL: "Root@Example.com",
    ...extra,
  });

/** A logger that keeps every message it is given. */
function recordingLog(): { log: FastifyBaseLogger; lines: string[] } {
  const lines: string[] = [];
  const write = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  const log = {
    info: write,
    warn: write,
    error: write,
    debug: write,
    trace: write,
    fatal: write,
  } as unknown as FastifyBaseLogger;
  return { log, lines };
}

const account = (over: Partial<NewLocalAccount>): NewLocalAccount => ({
  id: randomUUID(),
  email: "someone@example.com",
  displayName: "Someone",
  instanceRole: "user",
  status: "active",
  passwordHash: null,
  mustChangePassword: false,
  createdAt: new Date(NOW).toISOString(),
  ...over,
});

describe("bootstrapFirstAdmin without passwords", () => {
  it("creates the active admin without a password from ADMIN_EMAIL, and logs no setup link", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const { log, lines } = recordingLog();

    const result = await bootstrapFirstAdmin(oauthOnly(), accounts, log, () => NOW);

    expect(result).toEqual({ setupToken: null });
    const admin = await accounts.accountByEmail("root@example.com");
    expect(admin).toMatchObject({
      user: { email: "root@example.com", displayName: "root" },
      instanceRole: "admin",
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
    });
    expect(lines).toEqual([
      "created the first admin from ADMIN_EMAIL; they sign in with an OAuth2 method using that email",
    ]);
    expect(lines.join("\n")).not.toContain("set-password");
  });

  it("creates nothing while an active admin exists, even one without a password", async () => {
    const { accounts } = createMemoryLocalAccounts();
    await accounts.createAccount(account({ email: "boss@example.com", instanceRole: "admin" }));
    const { log, lines } = recordingLog();

    expect(await bootstrapFirstAdmin(oauthOnly(), accounts, log, () => NOW)).toEqual({
      setupToken: null,
    });
    expect(await accounts.accountByEmail("root@example.com")).toBeNull();
    expect(lines).toEqual([]);
  });

  it("READ_ONLY=true: creates nothing and logs no setup link", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const { log, lines } = recordingLog();

    await bootstrapFirstAdmin(oauthOnly({ READ_ONLY: "true" }), accounts, log, () => NOW);

    expect(await accounts.countAccounts()).toBe(0);
    expect(lines).toEqual([]);
  });

  it("leaves an existing account with the email as it is", async () => {
    const { accounts } = createMemoryLocalAccounts();
    await accounts.createAccount(account({ email: "root@example.com" }));
    const { log, lines } = recordingLog();

    await bootstrapFirstAdmin(oauthOnly(), accounts, log, () => NOW);

    expect((await accounts.accountByEmail("root@example.com"))?.instanceRole).toBe("user");
    expect(await accounts.countActiveAdmins()).toBe(0);
    expect(lines).toEqual([
      "ADMIN_EMAIL names an existing account, which was left as it is: no admin was created",
    ]);
  });

  it("logs no setup link without ADMIN_EMAIL under the dev sign-in", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const { log, lines } = recordingLog();
    const config = loadConfig({
      NODE_ENV: "test",
      USER_DIRECTORY: "local",
      IDENTITY_PROVIDER: "dev",
    });

    expect(await bootstrapFirstAdmin(config, accounts, log, () => NOW)).toEqual({
      setupToken: null,
    });
    expect(lines).toEqual([]);
  });
});
