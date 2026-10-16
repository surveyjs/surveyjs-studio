// The Survey Creator as surveyjs.io's editor page configures it (the site's page markup and
// Scripts/editor.tsx): the option values are copied (D14), the code is our own. Only the Creator
// chunk imports this module (see SurveyEditor.tsx).
import ace from "ace-builds";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-clouds_midnight";
import jsonWorkerUrl from "ace-builds/src-noconflict/worker-json?url";
import { Serializer, type ITheme } from "survey-core";
import "survey-core/i18n";
import SurveyTheme from "survey-core/themes";
import {
  AceJsonEditorModel,
  registerCreatorTheme,
  registerSurveyTheme,
  settings,
  type ICreatorTheme,
} from "survey-creator-core";
import { SurveyCreator } from "survey-creator-react";
import type { SurveyDefinition, SurveyTheme as StoredTheme } from "../api/content";

declare global {
  interface Window {
    ace?: typeof ace;
  }
}

/** Where surveyjs.io keeps the user's Creator UI theme (`editor.tsx`). */
const CREATOR_THEME_KEY = "OnlineEditorSurveyCreatorThemeV3";

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

let configured = false;

/** The page-wide settings of surveyjs.io's editor page, applied once. */
function configureOnce(): void {
  if (configured) return;
  configured = true;

  // The JSON tab uses Ace when `window.ace` is there. Its modules are bundled above; the JSON
  // worker is a separate file (Vite `?url`). The Creator sets Ace's JSON mode only when
  // `aceBasePath` is set, so it points at the folder of the bundled files.
  window.ace = ace;
  ace.config.setModuleUrl("ace/mode/json_worker", jsonWorkerUrl);
  AceJsonEditorModel.aceBasePath = jsonWorkerUrl.slice(0, jsonWorkerUrl.lastIndexOf("/") + 1);

  // As on the site, the survey themes are registered both for the survey and as Creator themes.
  registerSurveyTheme(SurveyTheme);
  registerCreatorTheme(SurveyTheme as unknown as Record<string, ICreatorTheme>);
  settings.layout.allowCollapseSidebar = false;
  const storeDataAsText = Serializer.findProperty("file", "storeDataAsText");
  if (storeDataAsText) storeDataAsText.visible = false;
}

function applySavedCreatorTheme(creator: SurveyCreator): void {
  try {
    const saved = window.localStorage.getItem(CREATOR_THEME_KEY);
    if (saved) creator.applyCreatorTheme(JSON.parse(saved) as ICreatorTheme);
  } catch {
    // No storage, or a value that does not parse: keep the default UI theme.
  }
}

function saveCreatorTheme(creator: SurveyCreator): void {
  try {
    window.localStorage.setItem(CREATOR_THEME_KEY, JSON.stringify(creator.creatorTheme));
  } catch {
    // No storage: the UI theme is not remembered.
  }
}

/**
 * The toolbar items and tabs surveyjs.io adds to its editor: Clear Survey, Help, Run, the
 * obfuscated JSON export, and the Embed Survey and Embed Creator tabs. They come with the next
 * part of the editor; this is where they are added.
 */
export function addSiteToolbarItemsAndTabs(
  creator: SurveyCreator,
  context: { readonly surveyId: string; readonly readOnly: boolean },
): void {
  void creator;
  void context;
}

/**
 * A new Creator for one survey. Without `saves` it is read-only: nothing can be changed and
 * nothing is saved. Otherwise every change is saved (500 ms after the last one) through `saves`.
 */
export function createCreator(options: {
  readonly surveyId: string;
  readonly saves: EditorSaves | null;
}): SurveyCreator {
  configureOnce();
  const creator = new SurveyCreator({
    showTranslationTab: true,
    showLogicTab: true,
    showThemeTab: true,
    generateValidJSON: true,
  });

  applySavedCreatorTheme(creator);
  creator.onCreatorThemePropertyChanged.add(() => saveCreatorTheme(creator));
  creator.onCreatorThemeSelected.add(() => saveCreatorTheme(creator));

  const { saves } = options;
  addSiteToolbarItemsAndTabs(creator, { surveyId: options.surveyId, readOnly: saves === null });

  if (saves === null) {
    creator.readOnly = true;
    return creator;
  }
  // Before the save functions: with auto-save on, the Creator shows no Save button.
  creator.autoSaveEnabled = true;
  creator.saveSurveyFunc = (saveNo: number, callback: (no: number, ok: boolean) => void) => {
    saves.definition(creator.JSON as SurveyDefinition, (ok) => callback(saveNo, ok));
  };
  creator.saveThemeFunc = (saveNo: number, callback: (no: number, ok: boolean) => void) => {
    saves.theme(creator.theme as StoredTheme, (ok) => callback(saveNo, ok));
  };
  return creator;
}

/**
 * Shows `documents` in the Creator: on open, and again after "Reload latest". A loaded theme is
 * not a pending change.
 */
export function loadDocuments(creator: SurveyCreator, documents: EditorDocuments): void {
  // The Themes tab reads the theme only when it opens; leave it so it reads the loaded one.
  if (creator.activeTab === "theme") creator.switchTab("designer");
  creator.JSON = documents.definition;
  // No stored theme (`{}`): the Creator's own empty theme.
  creator.theme =
    Object.keys(documents.theme).length === 0
      ? ({ cssVariables: {} } as ITheme)
      : (documents.theme as ITheme);
  creator.hasPendingThemeChanges = false;
}
