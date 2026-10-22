import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../cli/smoke-legacy.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "../providers/azure-legacy/index.js";
import { OWNER_ID, ownerUser, blockedUser } from "../providers/suite/expected.js";
import type { ProviderSet } from "../providers/types.js";
import { startLegacyStub, type LegacyStub } from "./legacy-stub.js";

// Runs in the `providers-azurite` Vitest project: `pnpm smoke:legacy` against an in-process stub of
// api.surveyjs.io that reads the local replica the way the old API does (legacy-data-layout
// section 7). The run writes a test survey and a test project of the fixture owner and deletes
// them; afterAll restores the golden fixtures anyway.

/** The canary: the owner's access key as the stub knows it. Never printed. */
const KEY = "5b0c6f2a9d8e4c1fa7b3e6d2c4f8a1b0";

const ENV = { ...replicaEnv(), STORAGE_PROVIDER: "azure-legacy", SMOKE_ACCESS_KEY: KEY };

const STEPS = [
  "create survey",
  "rename",
  "save definition",
  "history point",
  "save theme",
  "submit response",
  "public results",
  "publish",
  "unpublish",
  "create project",
  "move into project",
  "move to Personal",
  "delete survey",
];

describe("smoke:legacy against a stub of the legacy API on the replica", () => {
  let providers: ProviderSet;
  const stubs: LegacyStub[] = [];

  beforeAll(() => {
    providers = createAzureLegacyProviders(replicaConfig(), {});
  });

  afterAll(async () => {
    try {
      await Promise.all(stubs.map((stub) => stub.close()));
      await providers.close();
    } finally {
      await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
    }
  });

  async function stub(options: { corruptName?: boolean; key?: string } = {}): Promise<string> {
    const started = await startLegacyStub({
      config: replicaConfig(),
      accessKeys: { [options.key ?? KEY]: OWNER_ID },
      ...(options.corruptName && { corrupt: { name: true } }),
    });
    stubs.push(started);
    return started.url;
  }

  async function smoke(argv: string[], env: Record<string, string> = ENV) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, { env });
    return { code, out: out.join(""), err: err.join("") };
  }

  /** The owner's surveys named by a smoke run, in any scope the run used. */
  async function leftovers(): Promise<string[]> {
    const personal = await providers.surveys.listSurveys({ kind: "personal", userId: OWNER_ID });
    const projects = await providers.projects.listUserProjects(OWNER_ID);
    return [...personal.map((s) => s.name), ...projects.map((m) => m.project.name)].filter((name) =>
      name.startsWith("Smoke test"),
    );
  }

  it("passes every step, prints the table, cleans up and never prints the key", async () => {
    const url = await stub();
    const r = await smoke(["--account", ownerUser.email, "--yes", "--legacy-api", url]);
    expect(r.err).toBe("");
    expect(r.out).toContain("Result: PASSED.");
    expect(r.code).toBe(0);
    for (const step of STEPS) {
      expect(r.out).toMatch(new RegExp(`^\\| ${step} +\\|.*\\| pass +\\|$`, "m"));
    }
    expect(r.out).toMatch(/^\| delete project .*\| manual +\|$/m);
    expect(r.out).toContain("Result: PASSED.");
    expect(r.out + r.err).not.toContain(KEY);
    expect(await leftovers()).toEqual([]);
  });

  it("fails the steps whose legacy read disagrees, exits 1 and still cleans up", async () => {
    const url = await stub({ corruptName: true });
    const r = await smoke(["--account", ownerUser.email, "--yes", "--legacy-api", url]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^\| create survey .*\| FAIL +\|$/m);
    expect(r.out).toMatch(/^\| rename .*\| FAIL +\|$/m);
    expect(r.out).toMatch(
      /^rename: Name is ".* \(renamed\) \(changed\)", expected ".* \(renamed\)"$/m,
    );
    expect(r.out).toMatch(/^\| save definition .*\| pass +\|$/m);
    expect(r.out).toContain("Result: FAILED.");
    expect(r.out + r.err).not.toContain(KEY);
    expect(await leftovers()).toEqual([]);
  });

  it("never prints the key when the legacy API echoes it back", async () => {
    // The stub knows another key, so it answers 401 with the sent key in the text.
    const url = await stub({ key: "another-key-the-stub-knows-0000" });
    const r = await smoke(["--account", ownerUser.email, "--yes", "--legacy-api", url]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("create survey: getActive answered HTTP 401");
    expect(r.out + r.err).not.toContain(KEY);
    expect(await leftovers()).toEqual([]);
  });

  it("refuses a blocked account and an unknown one", async () => {
    const url = await stub();
    const blocked = await smoke(["--account", blockedUser.email, "--yes", "--legacy-api", url]);
    expect(blocked.code).toBe(2);
    expect(blocked.err).toContain("is blocked");
    const unknown = await smoke(["--account", "nobody@example.com", "--yes", "--legacy-api", url]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("no account with this email");
    expect(blocked.out + unknown.out).toBe("");
  });
});
