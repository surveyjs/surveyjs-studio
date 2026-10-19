import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  wireAutoSave,
  type AutoSaveCreator,
  type AutoSaveThemeTab,
  type EditorSaves,
} from "./creatorAutosave";

/** The Creator's auto-save delay. */
const DELAY = 500;

function fakeEvent() {
  const handlers: (() => void)[] = [];
  return {
    add: (handler: () => void) => void handlers.push(handler),
    fire: () => handlers.forEach((h) => h()),
  };
}

type Timer = ReturnType<typeof setTimeout> | null;

/**
 * What the wiring sees of the Creator and its Themes tab, behaving as Creator 3.1.2 does: a change
 * fires the event, then (re)schedules the save function after the delay in `autoSaveTimerId`.
 * `log` records the saves handed over and the dispose, in order; `outcomes` what reaches the
 * Creator's save callback.
 */
function setUp() {
  const log: string[] = [];
  const outcomes: [no: number, ok: boolean][] = [];
  const pendingReports: boolean[] = [];
  const done: ((ok: boolean) => void)[] = [];
  let saveNo = 0;

  const onModified = fakeEvent();
  const creator: AutoSaveCreator & { autoSaveTimerId: Timer } = {
    JSON: { title: "Mine" },
    theme: { themeName: "flat" },
    autoSaveEnabled: false,
    saveSurveyFunc: () => {},
    saveThemeFunc: () => {},
    onModified,
    applyPendingChanges: () => {},
    dispose: () => void log.push("dispose"),
    autoSaveTimerId: null,
  };
  const onThemeSelected = fakeEvent();
  const themeTab: AutoSaveThemeTab & { autoSaveTimerId: Timer } = {
    onThemeSelected,
    onThemePropertyChanged: fakeEvent(),
    autoSaveTimerId: null,
  };
  const saves: EditorSaves = {
    definition: (content, finish) => {
      log.push(`definition ${JSON.stringify(content)}`);
      done.push(finish);
    },
    theme: (content, finish) => {
      log.push(`theme ${JSON.stringify(content)}`);
      done.push(finish);
    },
  };
  const autoSave = wireAutoSave(creator, themeTab, saves, (pending) =>
    pendingReports.push(pending),
  );

  const callback = (no: number, ok: boolean) => void outcomes.push([no, ok]);
  /** A late timer, or the Creator's own: calls the save function as the Creator does. */
  const runSurveySave = () => creator.saveSurveyFunc(++saveNo, callback);
  const runThemeSave = () => creator.saveThemeFunc(++saveNo, callback);
  return {
    creator,
    autoSave,
    log,
    outcomes,
    pendingReports,
    done,
    runSurveySave,
    runThemeSave,
    /** A change in the Designer. */
    changeSurvey() {
      onModified.fire();
      if (creator.autoSaveTimerId) clearTimeout(creator.autoSaveTimerId);
      creator.autoSaveTimerId = setTimeout(() => {
        creator.autoSaveTimerId = null;
        runSurveySave();
      }, DELAY);
    },
    /** A change on the Themes tab. */
    changeTheme() {
      onThemeSelected.fire();
      if (themeTab.autoSaveTimerId) clearTimeout(themeTab.autoSaveTimerId);
      themeTab.autoSaveTimerId = setTimeout(() => {
        themeTab.autoSaveTimerId = null;
        runThemeSave();
      }, DELAY);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the editor's auto-save", () => {
  it("turns the Creator's auto-save on", () => {
    expect(setUp().creator.autoSaveEnabled).toBe(true);
  });

  it("saves a change after the delay and passes the Creator's save number back with the outcome", () => {
    const editor = setUp();

    editor.changeSurvey();
    expect(editor.pendingReports).toEqual([true]);
    vi.advanceTimersByTime(DELAY);

    expect(editor.log).toEqual(['definition {"title":"Mine"}']);
    expect(editor.pendingReports).toEqual([true, false]);
    editor.done[0]!(true);
    expect(editor.outcomes).toEqual([[1, true]]);

    editor.changeTheme();
    vi.advanceTimersByTime(DELAY);
    editor.done[1]!(false);
    expect(editor.log).toEqual(['definition {"title":"Mine"}', 'theme {"themeName":"flat"}']);
    expect(editor.outcomes).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("hands a pending definition and theme to the saves once each on close, then disposes", () => {
    const editor = setUp();
    editor.changeSurvey();
    editor.changeTheme();

    editor.autoSave.close();
    vi.advanceTimersByTime(DELAY * 4);

    expect(editor.log).toEqual([
      'definition {"title":"Mine"}',
      'theme {"themeName":"flat"}',
      "dispose",
    ]);
    expect(editor.pendingReports).toEqual([true, false]);
  });

  it("does not call back into the closed Creator when a save ends after close", () => {
    const editor = setUp();
    editor.changeSurvey();
    vi.advanceTimersByTime(DELAY);

    editor.autoSave.close();
    editor.done[0]!(true);

    expect(editor.outcomes).toEqual([]);
  });

  // Gap 1 (Step 6): a timer `close` could not cancel (a renamed private field) saves nothing.
  it("sends nothing and never calls back when a save function runs after close", () => {
    const editor = setUp();
    editor.autoSave.close();

    editor.runSurveySave();
    editor.runThemeSave();

    expect(editor.log).toEqual(["dispose"]);
    expect(editor.done).toEqual([]);
    expect(editor.outcomes).toEqual([]);
  });

  // Gap 2 (Step 6): a change made just before "Reload latest" is not saved over the loaded documents.
  it("drops a scheduled save when documents are loaded, then loads them", () => {
    const editor = setUp();
    editor.changeSurvey();
    editor.changeTheme();
    expect(editor.pendingReports).toEqual([true]);
    const loaded: string[] = [];

    editor.autoSave.load(() => loaded.push("documents"));
    vi.advanceTimersByTime(DELAY * 4);

    expect(loaded).toEqual(["documents"]);
    expect(editor.pendingReports).toEqual([true, false]);
    expect(editor.log).toEqual([]);

    // Nothing is pending any more: closing hands nothing over.
    editor.autoSave.close();
    expect(editor.log).toEqual(["dispose"]);
  });

  it("saves a change made after a load as usual", () => {
    const editor = setUp();
    editor.autoSave.load(() => {});

    editor.changeSurvey();
    vi.advanceTimersByTime(DELAY);

    expect(editor.log).toEqual(['definition {"title":"Mine"}']);
  });
});
