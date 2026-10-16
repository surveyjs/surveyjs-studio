export type SaverState = "saved" | "saving" | "error" | "conflict";

export interface DocumentSaver<T> {
  /** Ask for `content` to be saved; `done(ok)` is called once a save covering it ends. */
  request(content: T, done: (ok: boolean) => void): void;
  /** After "Reload latest": forget pending work, take the new ETag, state "saved". */
  reset(etag: string): void;
  readonly state: SaverState;
}

interface Pending<T> {
  content: T;
  callbacks: ((ok: boolean) => void)[];
}

/**
 * Saves one document with one request in flight. A request made during a flight replaces the
 * pending content; the replaced request's callback waits for the save that carries the newer one.
 */
export function createDocumentSaver<T>(options: {
  etag: string;
  save: (content: T, etag: string) => Promise<string>;
  isConflict: (error: unknown) => boolean;
  onChange: (state: SaverState) => void;
}): DocumentSaver<T> {
  let etag = options.etag;
  let state: SaverState = "saved";
  let inFlight = false;
  let pending: Pending<T> | null = null;
  // Bumped by reset: a save still in flight then belongs to a document that was reloaded.
  let generation = 0;

  const setState = (next: SaverState) => {
    if (state === next) return;
    state = next;
    options.onChange(next);
  };

  const failPending = () => {
    const dropped = pending;
    pending = null;
    dropped?.callbacks.forEach((done) => done(false));
  };

  async function run(content: T, callbacks: ((ok: boolean) => void)[]): Promise<void> {
    inFlight = true;
    setState("saving");
    const started = generation;
    let newEtag: string | null = null;
    let failure: unknown;
    try {
      newEtag = await options.save(content, etag);
    } catch (error) {
      failure = error;
    }
    inFlight = false;
    if (started !== generation) {
      // reset() dropped the work this save belonged to; requests made since go on with the new ETag.
      callbacks.forEach((done) => done(false));
      const next = pending;
      pending = null;
      if (next !== null) await run(next.content, next.callbacks);
      else setState("saved");
      return;
    }
    if (newEtag !== null) {
      etag = newEtag;
      callbacks.forEach((done) => done(true));
      const next = pending;
      pending = null;
      if (next !== null) await run(next.content, next.callbacks);
      else setState("saved");
      return;
    }
    callbacks.forEach((done) => done(false));
    failPending();
    setState(options.isConflict(failure) ? "conflict" : "error");
  }

  return {
    get state() {
      return state;
    },
    request(content, done) {
      if (state === "conflict") {
        done(false);
        return;
      }
      if (inFlight) {
        pending = { content, callbacks: [...(pending?.callbacks ?? []), done] };
        return;
      }
      void run(content, [done]);
    },
    reset(newEtag) {
      generation += 1;
      etag = newEtag;
      failPending();
      setState(inFlight ? "saving" : "saved");
    },
  };
}

export type EditorStatus =
  | { kind: "read-only" }
  | { kind: "conflict" }
  | { kind: "saving" }
  | { kind: "error" }
  | { kind: "saved" };

/** The footer status of the editor: read-only wins, then conflict, saving, error. */
export function editorStatus(states: readonly SaverState[], readOnly: boolean): EditorStatus {
  if (readOnly) return { kind: "read-only" };
  for (const kind of ["conflict", "saving", "error"] as const) {
    if (states.includes(kind)) return { kind };
  }
  return { kind: "saved" };
}

export const statusText: Record<"read-only" | "saving" | "error" | "saved", string> = {
  "read-only": "Read-only",
  saving: "Saving…",
  error: "Changes are not saved",
  saved: "All changes saved",
};
