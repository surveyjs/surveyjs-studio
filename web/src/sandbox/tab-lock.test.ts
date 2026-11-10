// The "tabs" below share one lock manager, as the tabs of one browser share theirs. Each tab has its
// own copy of localStorage, which another tab's write reaches only on `deliver()`, as a browser
// brings a tab's copy up to date a little after the write.
import { describe, expect, it } from "vitest";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { DEFAULT_SETTINGS } from "./settings";
import {
  STORAGE_KEY,
  StorageFullError,
  createSandboxStore,
  type KeyValueStorage,
  type SandboxData,
} from "./store";
import {
  createWriteLock,
  LOCK_NAME,
  NO_LOCK,
  StorageBusyError,
  type RevisionRecord,
  type WriteLock,
} from "./tab-lock";

const seed = seedJson as unknown as SandboxSeed;
/** An exclusive Web Lock manager in one page (jsdom has none): first come, first served. */
function fakeLocks(): Pick<LockManager, "request"> {
  let held = false;
  const waiting: (() => void)[] = [];
  const request = (
    _name: string,
    options: LockOptions,
    callback: () => Promise<unknown>,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const start = () => {
        held = true;
        Promise.resolve()
          .then(callback)
          .then(resolve, reject)
          .finally(() => {
            held = false;
            waiting.shift()?.();
          });
      };
      if (!held) return start();
      waiting.push(start);
      options.signal?.addEventListener("abort", () => {
        const at = waiting.indexOf(start);
        if (at < 0) return;
        waiting.splice(at, 1);
        reject(options.signal!.reason as Error);
      });
    });
  return { request: request as LockManager["request"] };
}
const TIMEOUT_MS = 300;

/** Two tabs' copies of one localStorage. */
function twoTabs() {
  const copies = [new Map<string, string>(), new Map<string, string>()];
  const listeners = [new Set<() => void>(), new Set<() => void>()];
  let pending: (() => void)[] = [];
  const storage = (tab: 0 | 1): KeyValueStorage => ({
    getItem: (key) => copies[tab]!.get(key) ?? null,
    setItem: (key, value) => {
      copies[tab]!.set(key, value);
      const other = tab === 0 ? 1 : 0;
      pending.push(() => {
        copies[other]!.set(key, value);
        for (const listener of listeners[other]!) listener();
      });
    },
    removeItem: (key) => void copies[tab]!.delete(key),
  });
  const onStorageChange = (tab: 0 | 1) => (listener: () => void) => {
    listeners[tab]!.add(listener);
    return () => void listeners[tab]!.delete(listener);
  };
  const deliver = () => {
    const now = pending;
    pending = [];
    for (const arrive of now) arrive();
  };
  return { storage, onStorageChange, deliver };
}

/** The revision record every tab reads from the same place (IndexedDB in a browser). */
function memoryRecord(): RevisionRecord & { value: number } {
  const record = {
    value: 0,
    get: () => Promise.resolve(record.value),
    set: (revision: number) => {
      record.value = revision;
      return Promise.resolve();
    },
  };
  return record;
}

function setUp() {
  const locks = fakeLocks();
  const tabs = twoTabs();
  const revisions = memoryRecord();
  const store = (tab: 0 | 1, lock?: WriteLock) =>
    createSandboxStore({
      storage: tabs.storage(tab),
      seed,
      settings: DEFAULT_SETTINGS,
      lock:
        lock ??
        createWriteLock({
          locks,
          revisions,
          onStorageChange: tabs.onStorageChange(tab),
          timeoutMs: TIMEOUT_MS,
        }),
    });
  return { locks, tabs, revisions, a: store(0), b: store(1), store };
}

const renameSurvey = (name: string) => (data: SandboxData) => {
  data.surveys[0]!.name = name;
};
const renameProject = (name: string) => (data: SandboxData) => {
  data.projects[0]!.name = name;
};
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the cross-tab lock", () => {
  it("makes a write wait for another tab's write to arrive, and keeps both", async () => {
    const { tabs, a, b } = setUp();
    await a.write(renameSurvey("From A"));
    // B's copy has not seen A's write yet.
    expect(b.read().surveys[0]?.name).toBe(seed.surveys[0]?.name);

    const pending = b.write(renameProject("From B"));
    await tick();
    tabs.deliver();
    const stored = await pending;

    expect(stored.surveys[0]?.name).toBe("From A");
    expect(stored.projects[0]?.name).toBe("From B");
    expect(stored.revision).toBe(2);
  });

  it("stores the seed of a first read only when no other tab's document arrives", async () => {
    const { tabs, revisions, a, b } = setUp();
    await a.write(renameSurvey("From A"));
    // B has seen nothing yet: it serves the seed, and would store it.
    expect(b.read().surveys[0]?.name).toBe(seed.surveys[0]?.name);
    await tick();
    tabs.deliver();
    await tick(80);
    // Had B stored its seed, it would reach A now.
    tabs.deliver();
    expect(a.read().surveys[0]?.name).toBe("From A");
    expect(b.read().surveys[0]?.name).toBe("From A");
    expect(revisions.value).toBe(1);
  });

  it("without Web Locks writes as before: the later write drops the earlier (D11)", async () => {
    const { tabs, store } = setUp();
    const a = store(0, NO_LOCK);
    const b = store(1, NO_LOCK);
    await a.write(renameSurvey("From A"));
    const stored = await b.write(renameProject("From B"));
    tabs.deliver();
    expect(stored.surveys[0]?.name).toBe(seed.surveys[0]?.name);
  });

  it("refuses a write whose wait times out, stores nothing, and lets the next write go ahead", async () => {
    const { tabs, revisions, a, b } = setUp();
    await a.write(renameSurvey("From A"));
    expect(revisions.value).toBe(1);

    await expect(b.write(renameProject("From B"))).rejects.toBeInstanceOf(StorageBusyError);
    expect(tabs.storage(1).getItem(STORAGE_KEY)).toBeNull();
    // What B has is recorded as the newest, so a document replaced without the lock (an older
    // build's tab, the developer tools) holds up one write only.
    expect(revisions.value).toBe(0);
    const stored = await b.write(renameProject("From B"));
    expect(stored.revision).toBe(1);
  });

  it("gives up with StorageBusyError when another tab holds the lock too long", async () => {
    const { locks, b } = setUp();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = locks.request(LOCK_NAME, {}, () => held);
    try {
      await expect(b.write(renameProject("From B"))).rejects.toBeInstanceOf(StorageBusyError);
    } finally {
      release();
      await holder;
    }
  });

  it("serialises writes in one tab too, and each write counts one revision", async () => {
    const { a, revisions } = setUp();
    await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        a.write((data) => {
          data.projects.push({ ...data.projects[0]!, id: `p${n}` });
        }),
      ),
    );
    const stored = a.read();
    expect(stored.projects.filter((p) => p.id.startsWith("p"))).toHaveLength(10);
    expect(stored.revision).toBe(10);
    expect(revisions.value).toBe(10);
  });

  it("passes on what the write throws and records no new revision", async () => {
    const { a, revisions } = setUp();
    await a.write(renameSurvey("First"));
    await expect(
      a.write(() => {
        throw new StorageFullError();
      }),
    ).rejects.toBeInstanceOf(StorageFullError);
    expect(revisions.value).toBe(1);
  });

  it("writes without waiting when the revision record fails", async () => {
    const tabs = twoTabs();
    const failing: RevisionRecord = {
      get: () => Promise.reject(new Error("no IndexedDB")),
      set: () => Promise.reject(new Error("no IndexedDB")),
    };
    const store = createSandboxStore({
      storage: tabs.storage(0),
      seed,
      settings: DEFAULT_SETTINGS,
      lock: createWriteLock({
        locks: fakeLocks(),
        revisions: failing,
        onStorageChange: tabs.onStorageChange(0),
        timeoutMs: TIMEOUT_MS,
      }),
    });
    expect((await store.write(renameSurvey("X"))).surveys[0]?.name).toBe("X");
  });

  it("writes without the lock when the browser refuses locks", async () => {
    const refusing: Pick<LockManager, "request"> = {
      request: (() =>
        Promise.reject(new DOMException("denied", "SecurityError"))) as LockManager["request"],
    };
    const lock = createWriteLock({
      locks: refusing,
      revisions: memoryRecord(),
      onStorageChange: () => () => {},
      timeoutMs: TIMEOUT_MS,
    });
    await expect(
      lock.run(
        () => 0,
        () => ({ value: "done", revision: 1 }),
      ),
    ).resolves.toBe("done");
  });

  it("is no lock at all without Web Locks", () => {
    const lock = createWriteLock({
      locks: undefined,
      revisions: memoryRecord(),
      onStorageChange: () => () => {},
      timeoutMs: TIMEOUT_MS,
    });
    expect(lock).toBe(NO_LOCK);
  });

  it("keeps counting across a reset, so another tab waits for the reset too", async () => {
    const { tabs, a, b } = setUp();
    await a.write(renameSurvey("From A"));
    tabs.deliver();
    await b.reset();
    expect(tabs.storage(1).getItem(STORAGE_KEY)).toMatch(/^\{"revision":2,/);

    const pending = a.write(renameProject("From A again"));
    await tick();
    tabs.deliver();
    const stored = await pending;
    expect(stored.surveys[0]?.name).toBe(seed.surveys[0]?.name);
    expect(stored.projects[0]?.name).toBe("From A again");
    expect(stored.revision).toBe(3);
  });
});
