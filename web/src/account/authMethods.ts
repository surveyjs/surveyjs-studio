import type { components } from "@surveyjs-studio/contract/types";

export type AuthMethod = components["schemas"]["AppConfig"]["authMethods"][number];
/** The methods that leave for another site (everything but the password form). */
export type ExternalMethod = Exclude<AuthMethod, "password">;

/** The text of each external sign-in link. */
export const EXTERNAL_SIGN_IN_LABELS: Record<ExternalMethod, string> = {
  surveyjs: "Sign in with SurveyJS",
  google: "Sign in with Google",
  github: "Sign in with GitHub",
  facebook: "Sign in with Facebook",
};

/** The provider names the refused page uses. */
export const PROVIDER_NAMES: Record<ExternalMethod, string> = {
  surveyjs: "SurveyJS",
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
};

export const isExternalMethod = (value: string | undefined): value is ExternalMethod =>
  value !== undefined && Object.hasOwn(EXTERNAL_SIGN_IN_LABELS, value);

/**
 * The hosted service's setup: surveyjs.io is the only method, so the server's login goes straight
 * to it and the app has no sign-in page of its own.
 */
export const isSurveyjsOnly = (methods: readonly AuthMethod[]): boolean =>
  methods.length === 1 && methods[0] === "surveyjs";
