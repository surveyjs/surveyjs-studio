// The Survey Creator as surveyjs.io's editor page configures it (the site's editor page and
// Scripts/editor.tsx): the option values are copied (D14), the code is our own. Only the Creator
// chunk imports this module (see SurveyEditor.tsx).
import ace from "ace-builds";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-clouds_midnight";
import jsonWorkerUrl from "ace-builds/src-noconflict/worker-json?url";
import {
  Action,
  ComputedUpdater,
  createDropdownActionModelAdvanced,
  Serializer,
  SvgRegistry,
  type ITheme,
} from "survey-core";
import "survey-core/i18n";
import SurveyTheme from "survey-core/themes";
import {
  AceJsonEditorModel,
  registerCreatorTheme,
  registerSurveyTheme,
  settings,
  type ICreatorPlugin,
  type ICreatorTheme,
  type ThemeTabPlugin,
} from "survey-creator-core";
import { SurveyCreator } from "survey-creator-react";
import obfuscatedDownloadIcon from "../shell/surveyjs-site/assets/icons/editor/obf-download.svg?raw";
import angularIcon from "../shell/surveyjs-site/assets/icons/editor/v1/angular.svg?raw";
import copyIconV1 from "../shell/surveyjs-site/assets/icons/editor/v1/copy.svg?raw";
import embedCreatorIconV1 from "../shell/surveyjs-site/assets/icons/editor/v1/embedcreator-24x24.svg?raw";
import embedSurveyIconV1 from "../shell/surveyjs-site/assets/icons/editor/v1/embedsurvey-24x24.svg?raw";
import helpIconV1 from "../shell/surveyjs-site/assets/icons/editor/v1/help.svg?raw";
import publishIconV1 from "../shell/surveyjs-site/assets/icons/editor/v1/publish.svg?raw";
import reactIcon from "../shell/surveyjs-site/assets/icons/editor/v1/react.svg?raw";
import vanillaIcon from "../shell/surveyjs-site/assets/icons/editor/v1/vanilla.svg?raw";
import copyIconV2 from "../shell/surveyjs-site/assets/icons/editor/v2/copy.svg?raw";
import embedCreatorIconV2 from "../shell/surveyjs-site/assets/icons/editor/v2/embedcreator-24x24.svg?raw";
import embedSurveyIconV2 from "../shell/surveyjs-site/assets/icons/editor/v2/embedsurvey-24x24.svg?raw";
import helpIconV2 from "../shell/surveyjs-site/assets/icons/editor/v2/help.svg?raw";
import publishIconV2 from "../shell/surveyjs-site/assets/icons/editor/v2/publish.svg?raw";
import { wireAutoSave, type EditorDocuments, type EditorSaves } from "./creatorAutosave";
import { addEmbedTabs } from "./embed/EmbedTab";
import { obfuscateSurvey } from "./obfuscate";
import { createUploadHandler, type EditorUploads } from "./uploads";

export type { EditorDocuments, EditorSaves, SaveRequest } from "./creatorAutosave";
export type { EditorUploads } from "./uploads";

declare global {
  interface Window {
    ace?: typeof ace;
  }
}

/** Where surveyjs.io keeps the user's Creator UI theme (`editor.tsx`). */
const CREATOR_THEME_KEY = "OnlineEditorSurveyCreatorThemeV3";

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
  registerSiteIcons();
}

/**
 * The site's icons for its toolbar items and tabs (Scripts/Models/embed-tab.tsx, editor.tsx), with
 * the site's names; those with a v1 and a v2 drawing follow the Creator's icon set.
 */
function registerSiteIcons(): void {
  const themed: [string, string, string][] = [
    ["copyembedded", copyIconV1, copyIconV2],
    ["embedsurvey", embedSurveyIconV1, embedSurveyIconV2],
    ["embedsurvey-24x24", embedSurveyIconV1, embedSurveyIconV2],
    ["embedcreator", embedCreatorIconV1, embedCreatorIconV2],
    ["eud", helpIconV1, helpIconV2],
    ["publish", publishIconV1, publishIconV2],
  ];
  for (const [name, v1, v2] of themed) {
    SvgRegistry.registerIcon(name, v1, "v1");
    SvgRegistry.registerIcon(name, v2, "v2");
  }
  SvgRegistry.registerIconFromSvg("react", reactIcon);
  SvgRegistry.registerIconFromSvg("angular", angularIcon);
  SvgRegistry.registerIconFromSvg("vanillajs", vanillaIcon);
  SvgRegistry.registerIconFromSvg("icon-obf-download", obfuscatedDownloadIcon);
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

const CLEAR_CONFIRM =
  "You are going to delete all elements in this survey. Do you want to proceed?";
const TOOL_GUIDE = "https://surveyjs.io/survey-creator/documentation/end-user-guide";

/**
 * Clear Survey, before the survey settings button of the toolbar and fifth in the footer (mobile)
 * toolbar, on the Designer tab. Unlike the site, the cleared survey is saved at once: the site saves
 * it only with the next change, so reloading the page brought the old survey back.
 */
function addClearSurvey(creator: SurveyCreator): void {
  const clear: Action = new Action({
    id: "clear-survey",
    visible: new ComputedUpdater(() => creator.activeTab === "designer"),
    iconName: "icon-clear",
    iconSize: "auto",
    title: "Clear Survey",
    showTitle: false,
    action: () => {
      if (!window.confirm(CLEAR_CONFIRM)) return;
      creator.JSON = {};
      clear.enabled = false;
      // Setting `JSON` is not a change for the Creator; this makes it one, so auto-save saves it.
      creator.setModified({ type: "CLEAR_SURVEY" });
    },
  });
  const settingsButton = creator.toolbarItems.find((item) => item.id === "svd-settings");
  if (settingsButton) {
    settingsButton.needSeparator = false;
    creator.toolbarItems.splice(creator.toolbarItems.indexOf(settingsButton), 0, clear);
  } else {
    creator.toolbarItems.push(clear);
  }
  creator.footerToolbar.actions.splice(4, 0, clear);
  creator.onModified.add((sender, options: { type?: string }) => {
    if (options.type === "OBJECT_DELETED" || options.type === "PAGE_ADDED") {
      clear.enabled = !sender.survey.isEmpty;
    }
  });
}

interface JsonTabModel {
  /** Errors or linter warnings in the text (warnings too in Creator 3.1). */
  readonly hasErrors: boolean;
  /** `true` when the text parses and has warnings at most (the Creator's own tab-switch check). */
  allowingDeactivate?: () => boolean | undefined;
  readonly text: string;
}

/** The site refuses a text with errors; linter warnings (new in Creator 3.1) do not count. */
const hasJsonErrors = (model: JsonTabModel) =>
  model.allowingDeactivate ? model.allowingDeactivate() !== true : model.hasErrors;

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * On the JSON tab, the Creator's download button becomes a drop-down: "Download JSON" (the
 * Creator's own download) and "Download obfuscated JSON" (`survey.obf.json`, see obfuscate.ts).
 */
function addObfuscatedExport(creator: SurveyCreator): void {
  // As the site: makes sure the JSON tab's plugin, which adds `svc-json-export`, exists (the
  // Creator normally creates it with its tabs).
  creator.getPlugin("json");
  const exportAction = creator.toolbarItems.find((item) => item.id === "svc-json-export");
  if (!exportAction) return;
  const downloadObfuscated = () => {
    const model = creator.getPlugin<ICreatorPlugin & { model?: JsonTabModel }>("json")?.model;
    if (!model) return;
    const fixErrors = () => creator.notify("Please fix error(s)", "error");
    if (hasJsonErrors(model)) {
      fixErrors();
      return;
    }
    let text: string;
    try {
      // The tab also accepts JSON5 (comments, unquoted keys, trailing commas), which JSON.parse
      // refuses; the tab's own parser is not exported.
      text = obfuscateSurvey(JSON.parse(model.text) as object);
    } catch {
      fixErrors();
      return;
    }
    downloadText("survey.obf.json", text);
  };
  const exportList = createDropdownActionModelAdvanced(
    {
      id: "svc-json-export-list",
      iconName: exportAction.iconName,
      // Not on the site: without it the button has no name (tooltip, screen readers).
      title: exportAction.title,
      showTitle: false,
      visible: new ComputedUpdater(() => creator.activeTab === "json"),
    },
    {
      items: [
        {
          id: exportAction.id,
          iconName: exportAction.iconName,
          iconSize: "auto",
          title: "Download JSON",
          action: exportAction.action,
        },
        {
          id: "download-obfuscated-survey",
          iconName: "icon-obf-download",
          iconSize: "auto",
          title: "Download obfuscated JSON",
          action: downloadObfuscated,
        },
      ],
    },
    { verticalPosition: "bottom", horizontalPosition: "center", cssClass: "svc-creator-popup" },
  );
  creator.toolbarItems.splice(creator.toolbarItems.indexOf(exportAction), 1, exportList);
}

const openInNewTab = (url: string) => window.open(url, "_blank", "noopener");

/**
 * The toolbar items and tabs surveyjs.io adds to its editor: Clear Survey (not in read-only mode),
 * the obfuscated JSON export, Help ("Read the tool guide"), Run, and the Embed Survey and Embed
 * Creator tabs (only with `embed`: the surveyjs-site shell, D21), in the site's order.
 */
export function addSiteToolbarItemsAndTabs(
  creator: SurveyCreator,
  context: { readonly surveyId: string; readonly readOnly: boolean; readonly embed: boolean },
): void {
  if (!context.readOnly) addClearSurvey(creator);
  addObfuscatedExport(creator);
  creator.toolbarItems.push(
    new Action({
      id: "goto-eud",
      iconName: "icon-eud",
      iconSize: "auto",
      visible: true,
      needSeparator: true,
      title: "Read the tool guide",
      showTitle: false,
      action: () => openInNewTab(TOOL_GUIDE),
    }),
  );
  creator.toolbarItems.push(
    new Action({
      id: "run-survey",
      iconName: "icon-publish",
      iconSize: "auto",
      visible: true,
      enabled: new ComputedUpdater(() => !creator.survey.isEmpty),
      title: "Click here to run this survey...",
      showTitle: false,
      action: () => openInNewTab(`/s/${encodeURIComponent(context.surveyId)}`),
    }),
  );
  if (context.embed) addEmbedTabs(creator, context.surveyId);
}

/** A Creator, how to load documents into it and how to close it. */
export interface CreatorSession {
  readonly creator: SurveyCreator;
  /**
   * Shows `documents` in the Creator: on open, and again after "Reload latest". A change still
   * waiting for the auto-save delay is dropped first, so it cannot save over the loaded documents.
   */
  load(documents: EditorDocuments): void;
  /**
   * Hands every change not yet sent to the saves (they finish on their own), then disposes the
   * Creator, so that leaving the editor loses no change and no Creator timer fires afterwards.
   */
  close(): void;
}

/**
 * A new Creator for one survey. Without `saves` it is read-only: nothing can be changed, saved or
 * uploaded. Otherwise every change is saved (500 ms after the last one) through `saves`, and files
 * go to `uploads` (without `uploads` the Creator keeps them in the survey JSON as data URLs).
 * `onPendingChange(true)` tells that a change is waiting for that delay (not yet handed to
 * `saves`), `onPendingChange(false)` that every change has been handed over.
 */
export function createCreator(options: {
  readonly surveyId: string;
  readonly saves: EditorSaves | null;
  readonly uploads: EditorUploads | null;
  /** The Embed tabs (`/config.features.embed`). */
  readonly embed: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}): CreatorSession {
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

  const { saves, uploads } = options;
  addSiteToolbarItemsAndTabs(creator, {
    surveyId: options.surveyId,
    readOnly: saves === null,
    embed: options.embed,
  });

  if (saves === null) {
    creator.readOnly = true;
    return {
      creator,
      load: (documents) => loadDocuments(creator, documents),
      close: () => creator.dispose(),
    };
  }

  let closed = false;
  const autoSave = wireAutoSave(
    creator,
    creator.getPlugin<ThemeTabPlugin>("theme"),
    saves,
    options.onPendingChange,
  );
  if (uploads !== null) {
    const upload = createUploadHandler({
      ...uploads,
      notify: (message) => creator.notify(message, "error"),
      isClosed: () => closed,
    });
    creator.onUploadFile.add((_, event) => upload(event));
  }

  return {
    creator,
    load: (documents) => autoSave.load(() => loadDocuments(creator, documents)),
    close() {
      closed = true;
      autoSave.close();
    },
  };
}

/** Shows `documents` in the Creator. A loaded theme is not a pending change. */
function loadDocuments(creator: SurveyCreator, documents: EditorDocuments): void {
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
