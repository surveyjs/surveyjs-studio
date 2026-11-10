/**
 * `sandbox` (`pnpm e2e:sandbox`, `pnpm e2e:sandbox:stories`): the sandbox build, whose API is a
 * mock in the page's service worker (ADR 0030). No server answers `/api`.
 */
export const sandboxMode = process.env["E2E_MODE"] === "sandbox";

/**
 * Why a user story does not run on the sandbox build, by cause. A spec or test that cannot apply
 * says so with `test.skip(sandboxMode, notOnSandbox.…)`; docs/testing.md lists them.
 */
export const notOnSandbox = {
  /** Data the shared fixtures have and the sandbox seed leaves out (server/fixtures/sandbox.json). */
  seed: (what: string) => `sandbox: the seed leaves out ${what}`,
  /** The sandbox runs the self-hosted shell. */
  shell: "sandbox: it checks the surveyjs-site shell; the sandbox runs the self-hosted shell",
  /** What only a server does or has. */
  server: (what: string) => `sandbox: ${what} needs a server`,
  /** Data lives in one browser's localStorage (ADR 0030, Consequences). */
  oneBrowser:
    "sandbox: a signed-out visitor needs another browser, and the sandbox's data stays in one",
  /** What the sandbox answers or shows differently by design (ADR 0030). */
  design: (what: string) => `sandbox: ${what} (ADR 0030)`,
} as const;
