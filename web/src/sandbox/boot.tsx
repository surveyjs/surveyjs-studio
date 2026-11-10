import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { SandboxOutdated } from "./SandboxOutdated";

/** How long the start (the settings file, then the service worker taking control) may take. */
export const START_TIMEOUT_MS = 20_000;

export const START_TIMEOUT_TEXT =
  "The demo did not start in time. Check your connection, then try again.";
export const UNSUPPORTED_TEXT =
  "This demo needs a browser with service workers and site storage. Open it in a current browser, not in a private window that blocks them.";

const PAGE_STYLE = {
  fontFamily: "sans-serif",
  maxWidth: "40rem",
  margin: "3rem auto",
  padding: "0 1rem",
} as const;

class StartTimeout extends Error {
  constructor(ms: number) {
    super(`The sandbox did not start within ${ms} ms.`);
    this.name = "StartTimeout";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StartTimeout(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function StartFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={PAGE_STYLE}>
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export interface BootOptions {
  /** Where the outdated offer or the failure message renders. */
  readonly root: HTMLElement;
  /** `startSandbox` (start.ts). */
  readonly start: () => Promise<"started" | "outdated">;
  /** Clears the demo data and the session; throws when the browser refuses. */
  readonly reset: () => void;
  readonly reload?: () => void;
  readonly timeoutMs?: number;
}

export interface BootResult {
  /** True when the sandbox runs and the app may render into `root`. */
  readonly booted: boolean;
  /** Removes what was rendered instead of the app (tests). */
  readonly unmount: () => void;
}

/**
 * Starts the sandbox before the app renders. Data of another version gets the reset offer; a start
 * that fails or does not settle within `timeoutMs` gets a message and Try again (a reload), so the
 * page is never left blank.
 */
export async function bootSandbox({
  root,
  start,
  reset,
  reload = () => location.reload(),
  timeoutMs = START_TIMEOUT_MS,
}: BootOptions): Promise<BootResult> {
  let status: "started" | "outdated";
  try {
    status = await withTimeout(start(), timeoutMs);
  } catch (error) {
    console.error("The sandbox could not start.", error);
    const message = error instanceof StartTimeout ? START_TIMEOUT_TEXT : UNSUPPORTED_TEXT;
    return render(root, <StartFailed message={message} onRetry={reload} />);
  }
  if (status === "started") return { booted: true, unmount: () => {} };
  return render(
    root,
    <SandboxOutdated
      onReset={() => {
        reset();
        reload();
      }}
    />,
  );
}

function render(root: HTMLElement, element: ReactElement): BootResult {
  const reactRoot = createRoot(root);
  reactRoot.render(<StrictMode>{element}</StrictMode>);
  return { booted: false, unmount: () => reactRoot.unmount() };
}
