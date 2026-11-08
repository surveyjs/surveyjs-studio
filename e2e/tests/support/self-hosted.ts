/** The instance's branding in self-hosted mode (`pnpm e2e:self-hosted`, playwright.config.ts). */
export const brand = {
  name: "Acme Surveys",
  accentColor: "#0a7d4f",
  termsUrl: "https://acme.example/terms",
  privacyUrl: "https://acme.example/privacy",
} as const;

/** `self-hosted`: the server runs the self-hosted shell with the branding above. */
export const selfHostedMode = process.env["E2E_MODE"] === "self-hosted";
