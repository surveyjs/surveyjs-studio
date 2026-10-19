import { useEffect, useRef, useState } from "react";
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { SurveyCreatorComponent, type SurveyCreator } from "survey-creator-react";
import {
  createCreator,
  loadDocuments,
  type EditorDocuments,
  type EditorSaves,
} from "./creatorSetup";

export type { EditorDocuments, EditorSaves } from "./creatorSetup";

export interface SurveyEditorProps {
  readonly surveyId: string;
  /** What to show; a new object loads into the open Creator ("Reload latest"). */
  readonly documents: EditorDocuments;
  /** Where changes go; `null` makes the Creator read-only. */
  readonly saves: EditorSaves | null;
  /**
   * `true` while a change waits for the Creator's auto-save delay (not yet handed to `saves`),
   * `false` once every change has been handed over.
   */
  readonly onPendingChange?: (pending: boolean) => void;
}

/**
 * The Survey Creator. This module and `creatorSetup.ts` are the only ones that import the Creator
 * and its styles, so the editor page loads them on demand (one dynamic import in EditorPage).
 * The Creator is built once per mount; on unmount its pending changes go to `saves` and it is
 * disposed.
 */
export function SurveyEditor({ surveyId, documents, saves, onPendingChange }: SurveyEditorProps) {
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  // The latest callback, without building a new Creator when it changes.
  const pendingCallback = useRef(onPendingChange);
  useEffect(() => {
    pendingCallback.current = onPendingChange;
  }, [onPendingChange]);

  // Built in the effect, not during render: the Creator holds timers and listeners that only
  // `dispose` releases, and Strict Mode runs effects twice (a disposed Creator cannot be reused).
  useEffect(() => {
    const session = createCreator({
      surveyId,
      saves,
      onPendingChange: (pending) => pendingCallback.current?.(pending),
    });
    setCreator(session.creator);
    return () => session.close();
  }, [surveyId, saves]);

  useEffect(() => {
    if (creator !== null) loadDocuments(creator, documents);
  }, [creator, documents]);

  return creator === null ? null : <SurveyCreatorComponent creator={creator} />;
}
