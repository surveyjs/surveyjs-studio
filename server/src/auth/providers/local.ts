import { AppError } from "../../errors.js";
import { publicUrl, type IdentityProvider } from "../identity.js";

/**
 * Sign-in when passwords are the only method (AUTH_METHODS=password): `login` sends the browser
 * to the web app's sign-in page, which signs in with `passwordLogin`; there is no provider to come
 * back from, and signing out ends at the start page.
 */
export function createLocalIdentityProvider(publicBaseUrl: string): IdentityProvider {
  return {
    authorizationUrl: (params) =>
      Promise.resolve(
        new URL(
          publicUrl(publicBaseUrl, `/sign-in?returnTo=${encodeURIComponent(params.returnTo)}`),
        ),
      ),
    finishSignIn: () =>
      Promise.reject(
        new AppError({
          code: "bad-request",
          status: 400,
          title: "Bad request",
          detail: "This instance signs in with email and password.",
        }),
      ),
    endSessionUrl: () => Promise.resolve(publicUrl(publicBaseUrl, "/")),
  };
}
