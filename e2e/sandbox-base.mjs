// The sandbox's base path in the e2e runs (ADR 0031, D11). `pnpm e2e:sandbox` builds for the root;
// `pnpm e2e:sandbox:subpath` builds for SANDBOX_SUBPATH (`SANDBOX_BASE`) and `vite preview` serves
// the build there. scripts/run.mjs sets SANDBOX_BASE for the build, the Playwright config reads it.

/** The sub-path of `pnpm e2e:sandbox:subpath`. */
export const SANDBOX_SUBPATH = "/studio/";

/**
 * `SANDBOX_BASE` with one leading and one trailing slash, `/` when unset or empty: the form the
 * build gives it (scripts/sandbox-host/base-path.ts, which also rejects anything but a plain path).
 */
export function sandboxBasePath(env) {
  const trimmed = (env["SANDBOX_BASE"] ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/** Whether the arguments pick the sub-path config (`--config playwright.sandbox-subpath.config.ts`). */
export function usesSandboxSubpathConfig(args) {
  return args.some((arg) =>
    /(^|[\\/=])playwright\.sandbox-subpath\.config(\.[cm]?[jt]s)?$/.test(arg),
  );
}
