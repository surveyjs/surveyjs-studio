import type { Readable } from "node:stream";

/**
 * Where the SQL providers keep file bytes (FILE_STORE): a folder on the data volume, or an
 * S3-compatible bucket. Keys are `{survey id}/{file id}`, lower-case; the metadata is in the
 * database's `files` table.
 */
export interface ByteStore {
  /** Stores the bytes under the key, replacing what is there. */
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  /** The bytes, streamed; null when nothing is stored under the key. */
  get(key: string): Promise<Readable | null>;
  /** Deletes the keys; a key with nothing stored is fine. */
  delete(keys: readonly string[]): Promise<void>;
  /** Copies the bytes of one key to another. */
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Whether the store can be written: a safe category in `reason` when it cannot. */
  probe(): Promise<{ readonly ok: boolean; readonly reason?: string }>;
}

/** `{survey id}/{file id}`: a lower-case GUID, a slash and 64 lower-case hex digits. */
export const BYTE_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}$/;

/** Refuses anything but a well-formed key, so no key can name a path outside the store. */
export function checkKey(key: string): string {
  if (!BYTE_KEY.test(key)) throw new Error("Not a file key");
  return key;
}
