import type { SandboxSettings } from "../settings";
import type { SandboxStore } from "../store";
import { notFound } from "./problems";

/** What every handler needs: the store, the settings and the sources of time and ids. */
export interface HandlerContext {
  readonly store: SandboxStore;
  readonly settings: SandboxSettings;
  /** The page's origin (no trailing slash), for absolute URLs such as a stored file's `url`. */
  readonly origin: string;
  readonly now: () => Date;
  /** A new lower-case GUID. */
  readonly newId: () => string;
  /**
   * The edition `/config` names; default `self-hosted`, the sandbox's own. Only `hosted` answers
   * the operations for surveys built for the old service (ADR 0039), as only the hosted server
   * routes them.
   */
  readonly edition?: "hosted" | "self-hosted";
}

/**
 * Refuses an operation for surveys built for the old service outside the hosted edition with
 * `404 not-found`, as the server answers a path it does not route (server/src/app.ts).
 */
export function requireHosted(ctx: HandlerContext): void {
  if (ctx.edition !== "hosted") throw notFound();
}

/**
 * A new id for a file of `surveyId`: its 32 hex digits, then 32 random ones (mirrors `newFileId` in
 * server/src/domain/file-id.ts, so the survey a file belongs to can be read off its id).
 */
export function newFileId(surveyId: string): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return surveyId.replaceAll("-", "").toLowerCase() + hex;
}
