import { useEffect, useRef, useState } from "react";
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { SurveyCreatorComponent } from "survey-creator-react";
import {
  createCreator,
  type CreatorSession,
  type EditorDocuments,
  type EditorSaves,
  type EditorUploads,
} from "./creatorSetup";

export type { EditorDocuments, EditorSaves, EditorUploads } from "./creatorSetup";

export interface SurveyEditorProps {
  readonly surveyId: string;
  /** What to show; a new object loads into the open Creator ("Reload latest"). */
  readonly documents: EditorDocuments;
  /** Where changes go; `null` makes the Creator read-only. */
  readonly saves: EditorSaves | null;
  /** Where files go (`null` in read-only mode). Keep it stable: a new object builds a new Creator. */
  readonly uploads: EditorUploads | null;
  /**
   * `true` while a change waits for the Creator's auto-save delay (not yet handed to `saves`),
   * `false` once every change has been handed over.
   */
  readonly onPendingChange?: (pending: boolean) => void;
  /** Called with `documents` once the Creator holds them (on open and after each new object). */
  readonly onDocumentsLoaded?: (documents: EditorDocuments) => void;
  /** Adds the Embed Survey and Embed Creator tabs (the surveyjs-site shell only, D21). */
  readonly embed: boolean;
}

/**
 * The Survey Creator. This module and `creatorSetup.ts` are the only ones that import the Creator
 * and its styles, so the editor page loads them on demand (one dynamic import in EditorPage).
 * The Creator is built once per mount; on unmount its pending changes go to `saves` and it is
 * disposed.
 */
export function SurveyEditor({
  surveyId,
  documents,
  saves,
  uploads,
  onPendingChange,
  onDocumentsLoaded,
  embed,
}: SurveyEditorProps) {
  const [session, setSession] = useState<CreatorSession | null>(null);
  // The latest callbacks, without building a new Creator when they change.
  const pendingCallback = useRef(onPendingChange);
  const loadedCallback = useRef(onDocumentsLoaded);
  useEffect(() => {
    pendingCallback.current = onPendingChange;
    loadedCallback.current = onDocumentsLoaded;
  }, [onPendingChange, onDocumentsLoaded]);

  // Built in the effect, not during render: the Creator holds timers and listeners that only
  // `dispose` releases, and Strict Mode runs effects twice (a disposed Creator cannot be reused).
  useEffect(() => {
    const created = createCreator({
      surveyId,
      saves,
      uploads,
      embed,
      onPendingChange: (pending) => pendingCallback.current?.(pending),
    });
    setSession(created);
    return () => created.close();
  }, [surveyId, saves, uploads, embed]);

  useEffect(() => {
    if (session === null) return;
    session.load(documents);
    loadedCallback.current?.(documents);
  }, [session, documents]);

  return session === null ? null : <SurveyCreatorComponent creator={session.creator} />;
}
