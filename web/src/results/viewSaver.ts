import type { ViewState } from "../api/views";

export const VIEW_SAVE_DELAY_MS = 500;

export interface ViewSaver {
  /** A new state: sent VIEW_SAVE_DELAY_MS after the last change (each change restarts the timer). */
  change(state: ViewState): void;
  /** Sends a waiting state now; resolves when every save started so far has ended. */
  flush(): Promise<void>;
  /** Drops a waiting state; resolves when a save in flight has ended (Reset waits for it). */
  cancel(): Promise<void>;
  /** flush(), then ignore every later change(). */
  close(): Promise<void>;
}

/**
 * Saves the user's layout, one request at a time. A state that is due while a save is in flight
 * waits in one slot (the newest replaces it) and goes out when the flight ends. A failure is
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
  let closed = false;

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const send = (state: ViewState) => {
    inFlight = options
      .save(state)
      .then(
        () => options.onSaved?.(),
        (error: unknown) => options.onError(error),
      )
      .then(() => {
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
    while (inFlight !== null) await inFlight;
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
