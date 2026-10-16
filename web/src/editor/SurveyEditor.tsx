import { useEffect, useState } from "react";
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
}

/**
 * The Survey Creator. This module and `creatorSetup.ts` are the only ones that import the Creator
 * and its styles, so the editor page loads them on demand (one dynamic import in EditorPage).
 * The Creator is built once per mount and disposed on unmount.
 */
export function SurveyEditor({ surveyId, documents, saves }: SurveyEditorProps) {
  const [creator, setCreator] = useState<SurveyCreator | null>(null);

  // Built in the effect, not during render: the Creator holds timers and listeners that only
  // `dispose` releases, and Strict Mode runs effects twice (a disposed Creator cannot be reused).
  useEffect(() => {
    const created = createCreator({ surveyId, saves });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the Creator is created and disposed with the mount
    setCreator(created);
    return () => created.dispose();
  }, [surveyId, saves]);

  useEffect(() => {
    if (creator !== null) loadDocuments(creator, documents);
  }, [creator, documents]);

  return creator === null ? null : <SurveyCreatorComponent creator={creator} />;
}
