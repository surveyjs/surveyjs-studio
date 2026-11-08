// Sandbox mode (`pnpm e2e:sandbox`): the sandbox build of the web app (web/dist-sandbox/, made by
// `build:sandbox`) behind `vite preview --mode sandbox`, with its mock back-end in the browser. No API
// server starts (playwright.config.ts).
process.env["E2E_MODE"] = "sandbox";

export default (await import("./playwright.config.js")).default;
