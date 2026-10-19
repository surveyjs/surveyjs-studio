// Sends a completed survey's answers (S19). No Form Library or React code here: `RunSurvey.tsx`
// connects this to the model's `onComplete`.
import { ApiError } from "../api/client";
import type { ResponseBody } from "../api/public";

/** The saving messages of the Form Library's complete page (its `onComplete` options). */
export interface SaveOptions {
  showSaveInProgress(text?: string): void;
  showSaveSuccess(text?: string): void;
  showSaveError(text?: string): void;
}

export const SUBMIT_MESSAGES = {
  alreadyCompleted: "You have already completed this survey.",
  tooLarge: "Your answers are too large to send.",
  rateLimited: "Too many attempts. Wait a minute, then try again.",
  failed: "Your answers were not sent. Check your connection and try again.",
} as const;

function errorMessage(error: unknown): string {
  const status = error instanceof ApiError ? error.problem.status : undefined;
  if (status === 413) return SUBMIT_MESSAGES.tooLarge;
  if (status === 429) return SUBMIT_MESSAGES.rateLimited;
  return SUBMIT_MESSAGES.failed;
}

/**
 * What the handler uses of the survey model. The library writes its "Limit to one response" cookie
 * (`{cookieName}=true`) on completion, before the answers are saved; both cookie methods do nothing
 * without a `cookieName`.
 */
export interface SubmitSender {
  readonly data: Record<string, unknown>;
  setCookie(): void;
  deleteCookie(): void;
}

/**
 * The `onComplete` handler of one survey model. Its first call creates the Idempotency-Key and
 * every later call reuses it: the library's "Try again" fires `onComplete` again for the same
 * answers, and the server stores them once. A call while a request is in flight does nothing;
 * once the answers are stored (or the server says this respondent has completed the survey), a
 * call shows the same success again without a request.
 *
 * The library's cookie is kept once the answers are stored (or the server says this respondent
 * has completed the survey) and deleted when sending fails: otherwise a reload after a failure
 * would show the library's "already completed" content with nothing stored.
 */
export function createSubmitHandler(deps: {
  readonly submit: (body: ResponseBody, idempotencyKey: string) => Promise<{ id: string }>;
  /** The client id when the limit is on (clientIds.ensure()), else undefined. */
  readonly clientId: () => string | undefined;
  readonly newKey?: () => string;
}): (sender: SubmitSender, options: SaveOptions) => void {
  const newKey = deps.newKey ?? (() => crypto.randomUUID());
  let key: string | undefined;
  let sending = false;
  /** The `showSaveSuccess` arguments once the handler is done (none: the library's own text). */
  let done: [] | [string] | null = null;

  return (sender, options) => {
    if (done !== null) {
      options.showSaveSuccess(...done);
      return;
    }
    if (sending) return;
    sending = true;
    key ??= newKey();
    options.showSaveInProgress();
    const clientId = deps.clientId();
    deps
      .submit({ data: sender.data, ...(clientId !== undefined && { clientId }) }, key)
      .then(
        () => {
          sending = false;
          done = [];
          sender.setCookie();
          options.showSaveSuccess();
        },
        (error: unknown) => {
          sending = false;
          if (error instanceof ApiError && error.problem.status === 409) {
            done = [SUBMIT_MESSAGES.alreadyCompleted];
            sender.setCookie();
            options.showSaveSuccess(...done);
            return;
          }
          sender.deleteCookie();
          options.showSaveError(errorMessage(error));
        },
      )
      // A throw in the library's message calls is not a failed submit (the answers are stored or
      // the error is shown); it only must not become an unhandled rejection.
      .catch(() => undefined);
  };
}
