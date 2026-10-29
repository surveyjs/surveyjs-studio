import { COMMON_PASSWORDS } from "./common-passwords.js";

/** The shortest password allowed, in characters (code points: an emoji counts once). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Why a new password cannot be used, as a sentence for the user; null when it can. The rules are
 * the spec's: at least 12 characters and not a common password, nothing else.
 */
export function passwordProblem(password: string): string | null {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "This password is too common. Choose another one.";
  }
  return null;
}
