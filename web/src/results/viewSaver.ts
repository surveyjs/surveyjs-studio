import type { ViewState } from "../api/views";

export const VIEW_SAVE_DELAY_MS = 500;

export interface ViewSaver {
  /** A new state: sent VIEW_SAVE_DELAY_MS after the last change (each change restarts the timer). */
  change(state: ViewState): void;
  /** Sends a waiting state now; resolves when every save started so far has ended. */
  flush(): Promise<void>;
  /** Drops a waiting state; resolves when a save in flight has ended (Reset waits for it). */
  cancel(): Promise<void>;
  /**
   * For `pagehide`: sends the newest waiting or pending state now, also beside a save in flight,
   * because the page may be gone before that flight ends.
   */
  sendNow(): void;
  /** flush(), then ignore every later change(). */
  close(): Promise<void>;
}

/**
 * Saves the user's layout, one request at a time. A state that is due while a save is in flight
 * waits in one slot (the newest replaces it) and goes out when the flight ends. Only sendNow()
 * (the page is being hidden) sends beside a flight. A failure is
 * reported and dropped; the next change saves again.
 */
export function createViewSaver(options: {
  save: (state: ViewState) => Promise<void>;
  /** A save failed; the next change tries again. */
  onError: (error: unknown) => void;
  /** A save succeeded. */
  onSaved?: () => void;
  delayMs?: number;
}): ViewSaver {
  const delayMs = options.delayMs ?? VIEW_SAVE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: ViewState | null = null;
  let pending: ViewState | null = null;
  let inFlight: Promise<void> | null = null;
  /** Saves sendNow() started beside the flight. */
  const besides = new Set<Promise<void>>();
  let closed = false;

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const report = (saving: Promise<void>) =>
    saving.then(
      () => options.onSaved?.(),
      (error: unknown) => options.onError(error),
    );

  const send = (state: ViewState) => {
    inFlight = report(options.save(state)).then(() => {
      inFlight = null;
      const next = pending;
      pending = null;
      if (next !== null) send(next);
    });
  };

  const due = () => {
    stopTimer();
    const state = waiting;
    waiting = null;
    if (state === null) return;
    if (inFlight === null) send(state);
    else pending = state;
  };

  /** Resolves when no save is in flight, including the one that follows a pending state. */
  const idle = async () => {
    while (inFlight !== null || besides.size > 0) {
      await Promise.all([inFlight, ...besides]);
    }
  };

  return {
    change(state) {
      if (closed) return;
      waiting = state;
      stopTimer();
      timer = setTimeout(due, delayMs);
    },
    flush() {
      due();
      return idle();
    },
    sendNow() {
      stopTimer();
      const state = waiting ?? pending;
      waiting = null;
      if (state === null) return;
      if (inFlight === null) {
        send(state);
        return;
      }
      // Two saves of one view are now open, and the server may finish them in either order. The
      // newest state stays pending as well, so if the page lives on it is sent once more after
      // the older flight ends and is the last save whatever the order. If the page is gone, the
      // older request started first; without this send the newest state would surely be lost.
      pending = state;
      const beside = report(options.save(state)).then(() => {
        besides.delete(beside);
      });
      besides.add(beside);
    },
    cancel() {
      stopTimer();
      waiting = null;
      pending = null;
      return idle();
    },
    close() {
      const flushed = this.flush();
      closed = true;
      return flushed;
    },
  };
}
