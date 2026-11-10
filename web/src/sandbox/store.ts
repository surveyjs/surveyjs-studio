import type { SandboxJson, SandboxSeed } from "./seed-types";
import type { SandboxSettings } from "./settings";
import { NO_LOCK, type WriteLock } from "./tab-lock";

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
  /**
   * Counts the writes (D11): each write stores one more than it read. Absent (0) in the seed and in
   * documents stored before the cross-tab lock.
   */
  revision?: number;
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
  constructor(message = "Browser storage is full.", options?: ErrorOptions) {
    super(message, options);
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
  /**
   * The stored document; the seed for a missing, unparsable or damaged one, which is then stored
   * holding the lock (D11). Throws `SandboxOutdatedError` for another data version.
   */
  read(): SandboxData;
  /**
   * Holding the cross-tab lock (D11), applies `change` to a deep copy of the stored document (its
   * return value, or the copy when it returns nothing), stores the result in one `setItem` and
   * resolves it. Rejects, storing nothing, with `StorageFullError` when the result reaches
   * `storageLimitKb` or the browser refuses it, with `StorageBusyError` when another tab keeps the
   * lock or its write does not arrive in time, and with whatever `change` throws.
   */
  write(change: (data: SandboxData) => SandboxData | void): Promise<SandboxData>;
  /**
   * Holding the lock, replaces the document with the seed; nothing else in the storage is touched.
   * Rejects with `StorageFullError` when the browser refuses the write, or `StorageBusyError`.
   */
  reset(): Promise<void>;
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

/**
 * The stored document's revision. A write puts `revision` first (`withRevision`), so the start of
 * the text is enough: a lock that waits for another tab's write looks at it often. Any other text
 * (an older document, no document) is revision 0.
 */
function storedRevisionOf(text: string | null): number {
  const match = text === null ? null : /^\{"revision":(\d+)[,}]/.exec(text);
  return match ? Number(match[1]) : 0;
}

/** `data` with `revision` as its first key (see `storedRevisionOf`). */
function withRevision(data: SandboxData, revision: number): SandboxData {
  // A key keeps the place it was first given: `revision` is first, and the last one sets its value.
  return { ...{ revision }, ...data, revision };
}

export function createSandboxStore(options: {
  storage: KeyValueStorage;
  seed: SandboxSeed;
  settings: SandboxSettings;
  /** The cross-tab lock (`browserWriteLock()` in the browser); none by default. */
  lock?: WriteLock;
}): SandboxStore {
  const { storage, seed, settings, lock = NO_LOCK } = options;

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

  /** The stored document, or the seed for a missing or damaged one; nothing is stored. */
  function current(): SandboxData {
    const found = inspect();
    if (found.status === "outdated") throw new SandboxOutdatedError();
    return found.status === "current" ? found.data : freshDocument();
  }

  const storedRevision = () => storedRevisionOf(storage.getItem(STORAGE_KEY));

  /**
   * Stores the seed, holding the lock, unless a document has arrived meanwhile: another tab may
   * have stored one this tab has not seen yet. Without Web Locks it runs at once.
   */
  function storeSeed(): void {
    lock
      .run(storedRevision, () => {
        const revision = storedRevision();
        if (inspect().status !== "fresh") return { value: undefined, revision };
        put(withRevision(freshDocument(), revision + 1), Number.POSITIVE_INFINITY);
        return { value: undefined, revision: revision + 1 };
      })
      .catch(() => {
        // The seed is served for this request; a later write reports a full storage.
      });
  }

  function read(): SandboxData {
    const found = inspect();
    if (found.status === "outdated") throw new SandboxOutdatedError();
    if (found.status === "current") return found.data;
    storeSeed();
    return freshDocument();
  }

  /** Stores `data` in one `setItem`, or throws `StorageFullError` and stores nothing. */
  function put(data: SandboxData, limitKb: number): void {
    const text = JSON.stringify(data);
    if (kbOf(text) >= limitKb) throw new StorageFullError();
    try {
      storage.setItem(STORAGE_KEY, text);
    } catch (error) {
      // Whatever the reason (QuotaExceededError, a blocked storage), the browser refused the write.
      throw new StorageFullError(undefined, { cause: error });
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_WRITTEN_EVENT));
  }

  return {
    read,
    status: () => inspect().status,
    write(change) {
      return lock.run(storedRevision, () => {
        const stored = current();
        const copy = structuredClone(stored);
        const revision = (stored.revision ?? 0) + 1;
        const next = withRevision(change(copy) ?? copy, revision);
        put(next, settings.storageLimitKb);
        return { value: next, revision };
      });
    },
    reset() {
      // Not `read()`: an outdated document is what a reset is for. The revision keeps counting, so
      // another tab still waits for this write to arrive.
      return lock.run(storedRevision, () => {
        const revision = storedRevision() + 1;
        put(withRevision(freshDocument(), revision), Number.POSITIVE_INFINITY);
        return { value: undefined, revision };
      });
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
