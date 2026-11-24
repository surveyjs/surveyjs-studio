import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import type { LocalAccountStore, NewLocalAccount, ProviderSet } from "../providers/types.js";
import { MEMORY_REFUSAL } from "./common.js";
import { parseArgs, READ_ONLY_MAKE_ADMIN, run, USAGE } from "./account-make-admin.js";

/** Settings of a persistent store with the local directory; the providers are injected. */
const LOCAL_ENV = {
  STORAGE_PROVIDER: "sqlite",
  APP_EDITION: "hosted",
  USER_DIRECTORY: "local",
  ADMIN_EMAIL: "admin@example.com",
};

const account = (over: Partial<NewLocalAccount> = {}): NewLocalAccount => ({
  id: randomUUID(),
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  instanceRole: "user",
  status: "active",
  passwordHash: null,
  mustChangePassword: false,
  createdAt: "2026-11-24T10:00:00.000Z",
  ...over,
});

/** Empty memory with local accounts. */
async function local(): Promise<{ providers: ProviderSet; accounts: LocalAccountStore }> {
  const providers = await createProviders(
    loadConfig({
      NODE_ENV: "test",
      USER_DIRECTORY: "local",
      AUTH_METHODS: "password",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "first admin password",
    }),
  );
  return { providers, accounts: providers.accounts! };
}

/** Links a surveyjs.io identity, so the account has a way to sign in. */
const linkSite = (accounts: LocalAccountStore, userId: string) =>
  accounts.linkIdentity({
    provider: "surveyjs",
    subject: userId,
    userId,
    email: "ada@example.com",
    emailVerified: true,
    createdAt: "2026-11-24T10:00:00.000Z",
  });

async function makeAdmin(
  argv: string[],
  providers: ProviderSet,
  env: Record<string, string> = LOCAL_ENV,
) {
  const out: string[] = [];
  const err: string[] = [];
  let made = 0;
  const code = await run(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    {
      env,
      makeProviders: () => {
        made += 1;
        return Promise.resolve(providers);
      },
    },
  );
  return { code, out: out.join(""), err: err.join(""), made };
}

describe("account:make-admin", () => {
  it("makes a disabled account with a sign-in an active instance admin, printing its id only", async () => {
    const { providers, accounts } = await local();
    const ada = await accounts.createAccount(account({ status: "disabled" }));
    await linkSite(accounts, ada.user.id);

    const r = await makeAdmin(["--email", "ADA@example.com"], providers);

    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toBe(`${ada.user.id} is now an active instance admin.\n`);
    expect(r.out).not.toContain("ada@example.com");
    expect(await accounts.account(ada.user.id)).toMatchObject({
      instanceRole: "admin",
      status: "active",
    });
  });

  it("says so when the account has no way to sign in yet", async () => {
    const { providers, accounts } = await local();
    const ada = await accounts.createAccount(account({ status: "invited" }));

    const r = await makeAdmin(["--email", "ada@example.com"], providers);

    expect(r.code).toBe(0);
    expect(r.out).toBe(
      `${ada.user.id} is now an instance admin, invited: it has no way to sign in yet.\n`,
    );
  });

  it("refuses an email no account has", async () => {
    const { providers } = await local();
    const r = await makeAdmin(["--email", "nobody@example.com"], providers);
    expect(r).toEqual({
      code: 1,
      out: "",
      err: "No account has this email. The person signs in first.\n",
      made: 1,
    });
  });

  it("refuses a deleted account's placeholder", async () => {
    const { providers, accounts } = await local();
    const gone = await accounts.createAccount(account({ instanceRole: "admin" }));
    const placeholder = await accounts.tombstoneAccount(gone.user.id);

    const r = await makeAdmin(["--email", placeholder!.user.email], providers);

    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("Refused: a deleted account's placeholder cannot be made admin.\n");
    expect(await accounts.account(gone.user.id)).toMatchObject({ status: "disabled" });
  });

  it("refuses READ_ONLY=true before opening any store", async () => {
    const { providers, accounts } = await local();
    await accounts.createAccount(account());
    const r = await makeAdmin(["--email", "ada@example.com"], providers, {
      ...LOCAL_ENV,
      READ_ONLY: "true",
    });
    expect(r).toEqual({ code: 2, out: "", err: `${READ_ONLY_MAKE_ADMIN}\n`, made: 0 });
    expect(await accounts.accountByEmail("ada@example.com")).toMatchObject({
      instanceRole: "user",
    });
  });

  it("refuses another user directory before opening any store", async () => {
    const { providers } = await local();
    const r = await makeAdmin(["--email", "ada@example.com"], providers, {
      STORAGE_PROVIDER: "sqlite",
    });
    expect(r).toEqual({
      code: 1,
      out: "",
      err: "Error: account:make-admin needs USER_DIRECTORY=local\n",
      made: 0,
    });
  });

  it("refuses the memory store", async () => {
    const { providers } = await local();
    const r = await makeAdmin(["--email", "ada@example.com"], providers, {
      STORAGE_PROVIDER: "memory",
    });
    expect(r).toEqual({ code: 2, out: "", err: `${MEMORY_REFUSAL}\n`, made: 0 });
  });

  it("reads its arguments", () => {
    expect(parseArgs(["--email", " ada@example.com ", "--env-file", "x.env"])).toEqual({
      kind: "run",
      email: "ada@example.com",
      envFile: "x.env",
    });
    expect(parseArgs([])).toEqual({ kind: "usage-error", message: "--email is required" });
    expect(parseArgs(["--email"])).toEqual({
      kind: "usage-error",
      message: "--email needs a value",
    });
    expect(parseArgs(["--email", "a@b.c", "--help"])).toEqual({ kind: "help" });
  });

  it("prints the usage with --help and on a usage error", async () => {
    const { providers } = await local();
    expect(await makeAdmin(["--help"], providers)).toEqual({
      code: 0,
      out: `${USAGE}\n`,
      err: "",
      made: 0,
    });
    const r = await makeAdmin(["--user", "x"], providers);
    expect(r.code).toBe(2);
    expect(r.err).toBe(`Unknown argument: --user\n\n${USAGE}\n`);
  });
});
