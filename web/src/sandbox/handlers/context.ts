import type { SandboxSettings } from "../settings";
import type { SandboxStore } from "../store";

/** What every handler needs: the store, the settings and the sources of time and ids. */
export interface HandlerContext {
  readonly store: SandboxStore;
  readonly settings: SandboxSettings;
  /** The page's origin (no trailing slash), for absolute URLs such as a stored file's `url`. */
  readonly origin: string;
  readonly now: () => Date;
  /** A new lower-case GUID. */
  readonly newId: () => string;
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
