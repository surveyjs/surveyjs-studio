import { setupWorker } from "msw/browser";
import { appRootUrl } from "../basePath";
import { createSandboxHandlers } from "./handlers";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { loadSandboxSettings } from "./settings";
import { createSandboxStore, type SandboxStore } from "./store";

let store: SandboxStore | undefined;

/** The sandbox's store; available after `startSandbox()` has run. */
export function sandboxStore(): SandboxStore {
  if (store === undefined) throw new Error("The sandbox has not started.");
  return store;
}

/**
 * Starts the in-browser back-end: the store on localStorage (seeded on the first read) and the
 * mock handlers in a service worker. Resolves once the worker controls the page. Resolves
 * `"outdated"`, starting no worker, when the stored data has another data version: the caller
 * offers `sandboxStore().reset()`. The worker, its scope and the API it answers are below the base
 * path (basePath.ts), so a sandbox on a sub-path keeps to it.
 */
export async function startSandbox(): Promise<"started" | "outdated"> {
  const settings = await loadSandboxSettings();
  store = createSandboxStore({
    storage: window.localStorage,
    seed: seedJson as unknown as SandboxSeed,
    settings,
  });
  if (store.status() === "outdated") return "outdated";
  const worker = setupWorker(
    ...createSandboxHandlers({
      store,
      settings,
      // The stored files' URLs are absolute: the API is below the base path.
      origin: appRootUrl(),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    }),
  );
  await worker.start({
    serviceWorker: {
      url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
      options: { scope: import.meta.env.BASE_URL },
    },
    quiet: true,
    onUnhandledRequest: "bypass",
  });
  return "started";
}
