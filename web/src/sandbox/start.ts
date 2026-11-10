import { setupWorker } from "msw/browser";
import { createSandboxHandlers } from "./handlers";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { loadSandboxSettings } from "./settings";
import { createSandboxStore, type SandboxStore } from "./store";
import { browserWriteLock } from "./tab-lock";

let store: SandboxStore | undefined;

/** The sandbox's store; available after `startSandbox()` has run. */
export function sandboxStore(): SandboxStore {
  if (store === undefined) throw new Error("The sandbox has not started.");
  return store;
}

/**
 * Starts the in-browser back-end: the store on localStorage (seeded on the first write) and the
 * mock handlers in a service worker. Resolves once the worker controls the page. Resolves
 * `"outdated"`, starting no worker, when the stored data has another data version: the caller
 * offers `sandboxStore().reset()`.
 */
export async function startSandbox(): Promise<"started" | "outdated"> {
  const settings = await loadSandboxSettings();
  store = createSandboxStore({
    storage: window.localStorage,
    seed: seedJson as unknown as SandboxSeed,
    settings,
    lock: browserWriteLock(),
  });
  if (store.status() === "outdated") return "outdated";
  const worker = setupWorker(
    ...createSandboxHandlers({
      store,
      settings,
      origin: location.origin,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    }),
  );
  await worker.start({
    serviceWorker: { url: "/mockServiceWorker.js" },
    quiet: true,
    onUnhandledRequest: "bypass",
  });
  return "started";
}
