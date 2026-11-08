import { AppError } from "../../errors.js";

/** A server fault of a sign-in: the provider could not be reached or answered unexpectedly. */
export function unavailable(cause: unknown): AppError {
  return new AppError({
    code: "internal-error",
    status: 500,
    title: "Sign-in is unavailable",
    detail:
      "The identity provider could not be reached or gave an unexpected answer. Try again later.",
    cause,
  });
}

/** A bad, reused or denied code: the sign-in is not valid, the server is fine. */
export function signInFailed(): AppError {
  return new AppError({
    code: "bad-request",
    status: 400,
    title: "Sign-in failed",
    detail: "The sign-in could not be completed. Sign in again.",
  });
}

/** Reads a JSON body; a non-object is an unexpected answer. */
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("the provider answered with something other than a JSON object");
  }
  return body as Record<string, unknown>;
}

/** The authorization response's `code`; a provider `error` (the user said no) is a 400. */
export function authorizationCode(callback: URL, expectedState: string): string {
  const { searchParams } = callback;
  if (searchParams.has("error")) throw signInFailed();
  const code = searchParams.get("code");
  if (!code || searchParams.get("state") !== expectedState) throw signInFailed();
  return code;
}

/** An AppError passes as it is; anything else is the server's fault. */
export function asSignInError(error: unknown): AppError {
  return error instanceof AppError ? error : unavailable(error);
}
