/** The instance's branding in powered-by mode (`pnpm e2e:powered-by`, playwright.config.ts). */
export const brand = {
  name: "Acme Surveys",
  accentColor: "#0a7d4f",
  termsUrl: "https://acme.example/terms",
  privacyUrl: "https://acme.example/privacy",
} as const;

/** `powered-by`: the server runs the powered-by shell with the branding above. */
export const poweredByMode = process.env["E2E_MODE"] === "powered-by";
