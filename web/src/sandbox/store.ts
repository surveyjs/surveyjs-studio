import type { SandboxJson, SandboxSeed } from "./seed-types";
import type { SandboxSettings } from "./settings";

/** What `window.localStorage` offers and the store needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A `Map`-backed storage for tests and Node. */
export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** The one key holding the whole sandbox document (D2). */
export const STORAGE_KEY = "studio-sandbox:v1";

/** Fired on `window` after a write is stored: the storage had room for it. */
export const STORAGE_WRITTEN_EVENT = "sandbox:storage-written";

/** An uploaded file; its bytes are kept as base64. */
export interface SandboxFile {
  id: string;
  surveyId: string | null;
  /** An editor upload (an asset, copied with a clone) or a respondent's file; absent means an asset. */
  kind?: "asset" | "respondent";
  name: string;
  contentType: string;
  /** The decoded size in bytes. */
  size: number;
  base64: string;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** The seed plus what writes add. */
export type SandboxData = Omit<SandboxSeed, "version"> & {
  readonly version: number;
  files: SandboxFile[];
  /** Idempotency keys of submitted responses: survey id, then key, to the response id. */
  idempotencyKeys: Record<string, Record<string, string>>;
  /**
   * Saved results views: user id, then survey id, then view name, to the view; `null` is a reset
   * (no layout, not even a legacy one, until the next save).
   */
  savedViews: Record<string, Record<string, Record<string, SandboxJson | null>>>;
};

/** The write would make the document reach `storageLimitKb`, or the browser refused it. */
export class StorageFullError extends Error {
  constructor(message = "Browser storage is full.") {
    super(message);
    this.name = "StorageFullError";
  }
}

/** The stored document has another data version than this build's seed; it is left as it is. */
export class SandboxOutdatedError extends Error {
  constructor(message = "The stored demo data has another data version.") {
    super(message);
    this.name = "SandboxOutdatedError";
  }
}

export interface SandboxStore {
  /**
   * `fresh`: nothing usable is stored (missing, unparsable or damaged), the next read seeds it;
   * `current`: a valid document with the seed's version; `outdated`: an object with another
   * numeric `version`, which `read` and `write` refuse to touch and only `reset` replaces.
   */
  status(): "fresh" | "current" | "outdated";
  /** The stored document; a missing, unparsable or damaged one is replaced by the seed first. Throws `SandboxOutdatedError` for another data version. */
  read(): SandboxData;
  /**
   * Applies `change` to a deep copy of the stored document (its return value, or the copy when it
   * returns nothing), stores the result in one `setItem` and returns it. Throws `StorageFullError`
   * and stores nothing when the result reaches `storageLimitKb` or the browser refuses it.
   */
  write(change: (data: SandboxData) => SandboxData | void): SandboxData;
  /** Replaces the document with the seed; nothing else in the storage is touched. */
  reset(): void;
  /** The stored document's size in KB: its length in UTF-16 code units x 2 / 1024. */
  usedKb(): number;
  /** True when `usedKb()` is at or above `storageLimitKb`. */
  isFull(): boolean;
}

const COLLECTIONS = [
  "users",
  "projects",
  "memberships",
  "invitations",
  "surveys",
  "files",
] as const;
const MAPS = [
  "definitions",
  "themes",
  "history",
  "responses",
  "completions",
  "legacyViews",
  "privateResultQuestions",
  "idempotencyKeys",
  "savedViews",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the document has the collections and maps of a sandbox document (its version aside). */
function isWellFormed(doc: Record<string, unknown>): doc is Record<string, unknown> & SandboxData {
  if (!COLLECTIONS.every((key) => Array.isArray(doc[key]))) return false;
  return MAPS.every((key) => {
    const entry = doc[key];
    return typeof entry === "object" && entry !== null && !Array.isArray(entry);
  });
}

export function createSandboxStore(options: {
  storage: KeyValueStorage;
  seed: SandboxSeed;
  settings: SandboxSettings;
}): SandboxStore {
  const { storage, seed, settings } = options;

  const freshDocument = (): SandboxData => ({
    ...structuredClone(seed),
    files: [],
    idempotencyKeys: {},
    savedViews: {},
  });
  const kbOf = (text: string) => (text.length * 2) / 1024;

  function inspect():
    { status: "fresh" } | { status: "outdated" } | { status: "current"; data: SandboxData } {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored === null) return { status: "fresh" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return { status: "fresh" };
    }
    if (!isObject(parsed) || typeof parsed.version !== "number") return { status: "fresh" };
    if (parsed.version !== seed.version) return { status: "outdated" };
    return isWellFormed(parsed) ? { status: "current", data: parsed } : { status: "fresh" };
  }

  function read(): SandboxData {
    const found = inspect();
    if (found.status === "outdated") throw new SandboxOutdatedError();
    if (found.status === "current") return found.data;
    const data = freshDocument();
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // The seed is served for this request; a later write reports the full storage.
    }
    return data;
  }

  return {
    read,
    status: () => inspect().status,
    write(change) {
      const copy = structuredClone(read());
      const next = change(copy) ?? copy;
      const text = JSON.stringify(next);
      if (kbOf(text) >= settings.storageLimitKb) throw new StorageFullError();
      try {
        storage.setItem(STORAGE_KEY, text);
      } catch {
        // Whatever the reason (QuotaExceededError, a blocked storage), the browser refused the write.
        throw new StorageFullError();
      }
      if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_WRITTEN_EVENT));
      return next;
    },
    reset() {
      storage.setItem(STORAGE_KEY, JSON.stringify(freshDocument()));
    },
    usedKb() {
      return kbOf(storage.getItem(STORAGE_KEY) ?? "");
    },
    isFull() {
      return kbOf(storage.getItem(STORAGE_KEY) ?? "") >= settings.storageLimitKb;
    },
  };
}

/** The sandbox session cookie (D3): the signed-in user's id. */
export const SESSION_COOKIE = "msid";

/** Browser only: sets `msid` for `userId` on path `/`, or clears it for null. */
export function setSessionCookie(userId: string | null): void {
  document.cookie =
    userId === null
      ? `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`
      : `${SESSION_COOKIE}=${encodeURIComponent(userId)}; path=/; SameSite=Lax`;
}
