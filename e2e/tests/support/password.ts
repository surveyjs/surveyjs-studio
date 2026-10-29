/**
 * The first admin of the password mode (`pnpm e2e:password`): the server creates it from
 * ADMIN_EMAIL and ADMIN_PASSWORD (playwright.config.ts), and it must change the password at its
 * first sign-in. Synthetic local-only test values.
 */
export const firstAdmin = {
  email: "first-admin@example.com",
  password: "e2e first admin password",
  /** The admin's display name: the server takes the email's local part. */
  name: "first-admin",
} as const;

/** `password`: the server signs in with passwords only, on the local user directory. */
export const passwordMode = process.env["E2E_MODE"] === "password";
