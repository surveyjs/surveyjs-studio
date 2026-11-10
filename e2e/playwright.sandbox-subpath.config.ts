// Sandbox mode on a sub-path (`pnpm e2e:sandbox:subpath`, ADR 0031 D11): the sandbox build for
// /studio/ (`SANDBOX_BASE`; scripts/run.mjs builds it) behind `vite preview --mode sandbox`, which
// serves it there and nothing at the root. The sandbox spec runs as in `pnpm e2e:sandbox`, and its
// request guard fails a test on any request outside /studio/.
import { SANDBOX_SUBPATH } from "./sandbox-base.mjs";

process.env["E2E_MODE"] = "sandbox";
process.env["SANDBOX_BASE"] = SANDBOX_SUBPATH;

export default (await import("./playwright.config.js")).default;
