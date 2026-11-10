/**
 * The title of the sandbox's `413 quota-exceeded` when the browser storage is full (ADR 0030). The
 * code is the one of the survey's file quota, so the title is what tells the two apart. The server
 * never sends it. No imports: the sandbox's handlers and the editor both read it.
 */
export const STORAGE_FULL_TITLE = "Browser storage is full";
