// The Creator's auto-save, wired to the page's saves. Structural types only, no Creator imports:
// the page chunk may import this module, and the unit tests drive it with a fake Creator.
import type { SurveyDefinition, SurveyTheme as StoredTheme } from "../api/content";

/** Saves one document; `done(ok)` once a save covering `content` ends. */
export type SaveRequest<T> = (content: T, done: (ok: boolean) => void) => void;

export interface EditorSaves {
  readonly definition: SaveRequest<SurveyDefinition>;
  readonly theme: SaveRequest<StoredTheme>;
}

export interface EditorDocuments {
  readonly definition: SurveyDefinition;
  readonly theme: StoredTheme;
}

/** A Creator event, as far as the wiring uses it. */
interface CreatorEvent {
  add(handler: () => void): void;
}

/** The Creator's save function: `callback(saveNo, ok)` once the save ends. */
type CreatorSaveFunction = (saveNo: number, callback: (no: number, ok: boolean) => void) => void;

/**
 * The members of `SurveyCreator` the wiring uses. Creator 3.1.2 also keeps a scheduled auto-save
 * in a private `autoSaveTimerId` (no public call cancels it); a private member cannot be part of a
 * type the Creator satisfies, so it is read through a cast (see `cancelAutoSave`).
 */
export interface AutoSaveCreator {
  readonly JSON: unknown;
  readonly theme: object;
  autoSaveEnabled: boolean;
  saveSurveyFunc: CreatorSaveFunction;
  saveThemeFunc: CreatorSaveFunction;
  readonly onModified: CreatorEvent;
  applyPendingChanges(): unknown;
  dispose(): void;
}

/** The members of the Creator's Themes tab plugin the wiring uses (and its `autoSaveTimerId`). */
export interface AutoSaveThemeTab {
  readonly onThemeSelected: CreatorEvent;
  readonly onThemePropertyChanged: CreatorEvent;
}

export interface AutoSave {
  /**
   * Cancels both scheduled auto-saves and clears the pending flags (reports `false`), then runs
   * `load`: a change scheduled before the load would otherwise save the old content over the
   * loaded one.
   */
  load(load: () => void): void;
  /**
   * Applies the JSON tab, hands every change not yet sent to the saves (they finish on their own),
   * stops all later saves, then disposes the Creator, so that leaving the editor loses no change
   * and no Creator timer saves afterwards.
   */
  close(): void;
}

/**
 * Cancels a scheduled auto-save. Creator 3.1.2 keeps the timer in a private `autoSaveTimerId`: the
 * Creator's for the survey, the Themes tab plugin's for the theme. Should an upgrade rename it,
 * a late timer still saves nothing after `close` (the save functions check first).
 */
function cancelAutoSave(owner: object | undefined): void {
  const timed = owner as { autoSaveTimerId?: ReturnType<typeof setTimeout> | null } | undefined;
  if (timed?.autoSaveTimerId) {
    clearTimeout(timed.autoSaveTimerId);
    timed.autoSaveTimerId = null;
  }
}

/**
 * Saves every change of `creator` (500 ms after the last one, the Creator's delay) through
 * `saves`. `onPendingChange(true)` tells that a change is waiting for that delay (not yet handed
 * to `saves`), `onPendingChange(false)` that every change has been handed over.
 */
export function wireAutoSave(
  creator: AutoSaveCreator,
  themeTab: AutoSaveThemeTab | undefined,
  saves: EditorSaves,
  onPendingChange?: (pending: boolean) => void,
): AutoSave {
  // A change is pending from the event the Creator schedules its auto-save with (`onModified` for
  // the survey, the Themes tab's change events for the theme) until the save function runs.
  let closed = false;
  const pending = { definition: false, theme: false };
  let reported = false;
  const report = () => {
    const now = pending.definition || pending.theme;
    if (now === reported) return;
    reported = now;
    onPendingChange?.(now);
  };
  const changed = (document: keyof typeof pending) => {
    if (closed) return;
    pending[document] = true;
    report();
  };
  const sendDefinition = (done: (ok: boolean) => void) => {
    saves.definition(creator.JSON as SurveyDefinition, done);
    pending.definition = false;
    report();
  };
  const sendTheme = (done: (ok: boolean) => void) => {
    saves.theme(creator.theme as StoredTheme, done);
    pending.theme = false;
    report();
  };
  const cancelAutoSaves = () => {
    cancelAutoSave(creator);
    cancelAutoSave(themeTab);
  };

  creator.onModified.add(() => changed("definition"));
  themeTab?.onThemeSelected.add(() => changed("theme"));
  themeTab?.onThemePropertyChanged.add(() => changed("theme"));

  // Before the save functions: with auto-save on, the Creator shows no Save button.
  creator.autoSaveEnabled = true;
  // Once closed, a late timer sends nothing; a save that ends after `close` does not call back
  // into the disposed Creator.
  creator.saveSurveyFunc = (saveNo, callback) => {
    if (closed) return;
    sendDefinition((ok) => {
      if (!closed) callback(saveNo, ok);
    });
  };
  creator.saveThemeFunc = (saveNo, callback) => {
    if (closed) return;
    sendTheme((ok) => {
      if (!closed) callback(saveNo, ok);
    });
  };

  return {
    load(load) {
      cancelAutoSaves();
      pending.definition = false;
      pending.theme = false;
      report();
      load();
    },
    close() {
      // Text typed on the JSON tab reaches the survey when the tab is left; leaving the page
      // leaves it too (text that does not parse, or has errors, is not applied).
      creator.applyPendingChanges();
      cancelAutoSaves();
      if (pending.definition) sendDefinition(() => {});
      if (pending.theme) sendTheme(() => {});
      closed = true;
      creator.dispose();
      // Disposing leaves the open tab, which may apply the JSON tab's text and schedule a save.
      cancelAutoSaves();
    },
  };
}
