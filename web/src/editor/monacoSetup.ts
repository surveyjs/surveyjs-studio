import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/language/json/monaco.contribution";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import type { SurveyCreator } from "survey-creator-react";

declare global {
  interface Window {
    monaco?: typeof monaco;
    MonacoEnvironment?: monaco.Environment;
  }
}

export function installMonaco(): void {
  window.MonacoEnvironment = {
    getWorker: (_, label) => (label === "json" ? new JsonWorker() : new EditorWorker()),
  };
  window.monaco = monaco;
}

function applyMonacoTheme(creator: SurveyCreator): void {
  monaco.editor.setTheme(creator.preferredColorPalette === "dark" ? "vs-dark" : "vs");
}

export function followCreatorColorPalette(creator: SurveyCreator): void {
  applyMonacoTheme(creator);
  creator.onCreatorThemeSelected.add(() => applyMonacoTheme(creator));
  creator.onCreatorThemePropertyChanged.add(() => applyMonacoTheme(creator));
}
