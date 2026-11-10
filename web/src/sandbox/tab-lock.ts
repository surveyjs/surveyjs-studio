// The cross-tab lock of the sandbox store (ADR 0030, D11). Every tab of the sandbox reads and writes
// the same localStorage document. A tab's localStorage is a copy that the browser brings up to date
// a little after another tab writes, so two tabs could each write a change on top of the same old
// document, and the later write would drop the earlier one. Here, a write holds a Web Lock, so no
// two writes run at once in this browser, and a write first waits until this tab's copy of the
// document has the newest revision any tab stored. That revision is kept in IndexedDB, which every
// tab reads from the same place. Where an API is missing, the lock does less, never something else.

/** The name of the Web Lock the store's writes hold. */
export const LOCK_NAME = "studio-sandbox:v1";

/**
 * Another tab holds the lock for too long, or its last write has not reached this tab in time. Nothing
 * was stored; the request may be sent again.
 */
export class StorageBusyError extends Error {
  constructor(message = "Another tab is saving the demo data. Try again.") {
    super(message);
    this.name = "StorageBusyError";
  }
}

/** Serialises the store's writes across the tabs of one browser. */
export interface WriteLock {
  /**
   * Runs `write` while no other write of this browser runs. First waits until `storedRevision()`
   * (the revision of this tab's copy of the document) reaches the newest revision any tab recorded;
   * `write` stores the document and returns its new revision, which is recorded before the lock is
   * released. Rejects with `StorageBusyError` when the lock or the newest revision does not come in
   * time, and with whatever `write` throws.
   */
  run<T>(storedRevision: () => number, write: () => { value: T; revision: number }): Promise<T>;
}

/** No other tab to wait for: runs the write at once (tests, Node, a browser without Web Locks). */
export const NO_LOCK: WriteLock = {
  run: (_storedRevision, write) => {
    try {
      return Promise.resolve(write().value);
    } catch (error) {
      return Promise.reject(error as Error);
    }
  },
};

/** Where the newest stored revision is recorded, outside localStorage. */
export interface RevisionRecord {
  get(): Promise<number>;
  set(revision: number): Promise<void>;
}

/** What `createWriteLock` needs; the browser's own in `browserWriteLock`. */
export interface WriteLockDeps {
  /** `navigator.locks`; without it every write runs at once, as before the lock (D11). */
  readonly locks: Pick<LockManager, "request"> | undefined;
  /** IndexedDB's record; without it, or when it fails, a write does not wait for other tabs' writes. */
  readonly revisions: RevisionRecord | undefined;
  /** Calls `listener` when another tab changed localStorage; returns a function that stops it. */
  readonly onStorageChange: (listener: () => void) => () => void;
  /** How long a write waits for the lock, and then for another tab's write to arrive. */
  readonly timeoutMs: number;
}

/** How often a waiting write looks at its copy again, in case a storage event is missed. */
const POLL_MS = 50;

/** Resolves true once `ready()` holds, false after `timeoutMs`. */
function waitUntil(
  ready: () => boolean,
  onStorageChange: WriteLockDeps["onStorageChange"],
  timeoutMs: number,
): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => {
      if (!ready()) return;
      finish(true);
    };
    const stop = onStorageChange(check);
    const poll = setInterval(check, POLL_MS);
    const timer = setTimeout(() => finish(ready()), timeoutMs);
    function finish(result: boolean) {
      stop();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(result);
    }
  });
}

export function createWriteLock(deps: WriteLockDeps): WriteLock {
  const { locks, revisions, onStorageChange, timeoutMs } = deps;
  if (locks === undefined) return NO_LOCK;

  const newestRecorded = async (): Promise<number | undefined> => {
    try {
      return await revisions?.get();
    } catch {
      return undefined;
    }
  };
  const record = async (revision: number): Promise<void> => {
    try {
      await revisions?.set(revision);
    } catch {
      // The next write in another tab cannot wait for this one; the lock still keeps them apart.
    }
  };

  return {
    async run(storedRevision, write) {
      let granted = false;
      try {
        // The signal gives up a request still waiting for the lock; a granted lock is not affected.
        return await locks.request(
          LOCK_NAME,
          { signal: AbortSignal.timeout(timeoutMs) },
          async () => {
            granted = true;
            const newest = await newestRecorded();
            if (newest !== undefined && storedRevision() < newest) {
              const arrived = await waitUntil(
                () => storedRevision() >= newest,
                onStorageChange,
                timeoutMs,
              );
              if (!arrived) {
                // Most likely the document was replaced without the lock (a tab of an older build,
                // the developer tools): record what is stored, so that the next write goes ahead.
                await record(storedRevision());
                throw new StorageBusyError();
              }
            }
            const { value, revision } = write();
            await record(revision);
            return value;
          },
        );
      } catch (error) {
        if (granted) throw error;
        // The signal's timeout: another tab held the lock for too long.
        const name = (error as { name?: unknown } | null)?.name;
        if (name === "TimeoutError" || name === "AbortError") throw new StorageBusyError();
        // The browser refuses locks here (say, a sandboxed frame): write as without them.
        return NO_LOCK.run(storedRevision, write);
      }
    },
  };
}

const DB_NAME = "studio-sandbox-tabs";
const STORE_NAME = "revision";
const KEY = "newest";

/** The newest revision in IndexedDB: one number in its own database, which Reset leaves alone. */
export function indexedDbRevisions(factory: IDBFactory): RevisionRecord {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB did not open."));
    }));
  const transact = async <T>(
    mode: IDBTransactionMode,
    act: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = act(transaction.objectStore(STORE_NAME));
      // `complete`, not the request's `success`: only then is a write seen by every other tab.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error("The IndexedDB transaction failed."));
    });
  };
  return {
    async get() {
      const value: unknown = await transact("readonly", (store) => store.get(KEY));
      return typeof value === "number" ? value : 0;
    },
    async set(revision) {
      await transact("readwrite", (store) => store.put(revision, KEY));
    },
  };
}

/** The lock with the browser's Web Locks, IndexedDB and storage events, each where it exists. */
export function browserWriteLock(timeoutMs = 2000): WriteLock {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  const revisions = typeof indexedDB === "undefined" ? undefined : indexedDbRevisions(indexedDB);
  return createWriteLock({
    locks,
    revisions,
    timeoutMs,
    onStorageChange: (listener) => {
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
  });
}
