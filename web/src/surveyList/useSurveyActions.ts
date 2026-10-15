import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  useCloneSurvey,
  useDeleteSurvey,
  useUpdateSurvey,
  type Survey,
  type SurveyPatch,
} from "../api/surveys";
import type { ActionItemId, CopyItemId } from "./menuItems";
import { surveyListSearch } from "./search";

/** The site's confirmation texts (copied verbatim, "organization" included). */
export const MOVE_CONFIRMATION =
  "Do you want to move this survey to another organization? This operation can't be undone.";
export const DELETE_CONFIRMATION =
  "Do you really want to delete this survey? This operation can't be undone.";

export const CLIPBOARD_ERROR = "Could not copy to the clipboard.";

/** The message for a failed row action, by its verb (`rename`, `publish`, …). */
export const actionError = (verb: string) => `Could not ${verb} the survey. Please try again.`;

/** A menu item that runs an action; Run, Edit, View Results and View History are links instead. */
export type SurveyAction =
  | { id: Exclude<ActionItemId, "run" | "edit" | "results" | "history"> }
  | { id: CopyItemId }
  | { id: "move"; target: string | null };

export interface SurveyActions {
  /** Runs a menu action on the survey (asking first for Move and Delete). */
  run(survey: Survey, action: SurveyAction): void;
  /** Sends a new name; resolves to false when the request failed. */
  rename(survey: Survey, name: string): Promise<boolean>;
}

const PATCHES: Record<"publish" | "unpublish" | "archive" | "restore", SurveyPatch> = {
  publish: { published: true },
  unpublish: { published: false },
  archive: { archived: true },
  restore: { archived: false },
};

const COPIED: Record<CopyItemId, (survey: Survey) => string> = {
  "copy-id": (survey) => survey.id,
  "copy-result-id": (survey) => survey.resultId,
  "copy-post-id": (survey) => survey.postId,
};

/**
 * The row actions of the survey list and the page's one error message. Every action clears the
 * message; a failed one sets it. The list stays as it is (the cache rules refresh it), except after
 * a move, which opens the target scope's active list, as the site does.
 */
export function useSurveyActions(): { error: string | null; actions: SurveyActions } {
  const navigate = useNavigate();
  const update = useUpdateSurvey();
  const clone = useCloneSurvey();
  const remove = useDeleteSurvey();
  const [error, setError] = useState<string | null>(null);

  // mutateAsync, not mutate: mutate's own callbacks run only for the latest call of the hook.
  const attempt = (verb: string, request: Promise<unknown>) =>
    request.then(
      () => true,
      () => {
        setError(actionError(verb));
        return false;
      },
    );

  const patch = (survey: Survey, verb: string, body: SurveyPatch) =>
    attempt(verb, update.mutateAsync({ survey, patch: body }));

  const copy = (value: string) => {
    let writing: Promise<void>;
    try {
      writing = navigator.clipboard.writeText(value);
    } catch (failure) {
      // No clipboard API (an insecure context).
      writing = Promise.reject(failure instanceof Error ? failure : new Error(String(failure)));
    }
    void writing.catch(() => setError(CLIPBOARD_ERROR));
  };

  const run = (survey: Survey, action: SurveyAction) => {
    switch (action.id) {
      case "clone":
        setError(null);
        void attempt("clone", clone.mutateAsync(survey));
        return;
      case "publish":
      case "unpublish":
      case "archive":
      case "restore":
        setError(null);
        void patch(survey, action.id, PATCHES[action.id]);
        return;
      case "delete":
        if (!window.confirm(DELETE_CONFIRMATION)) return;
        setError(null);
        void attempt("delete", remove.mutateAsync(survey));
        return;
      case "move": {
        if (!window.confirm(MOVE_CONFIRMATION)) return;
        setError(null);
        const target = action.target;
        void patch(survey, "move", { projectId: target }).then((moved) => {
          if (!moved) return;
          void navigate({
            to: "/",
            search: surveyListSearch({ project: target ?? "personal", archived: false }),
          });
        });
        return;
      }
      case "copy-id":
      case "copy-result-id":
      case "copy-post-id":
        setError(null);
        copy(COPIED[action.id](survey));
        return;
    }
  };

  const rename = (survey: Survey, name: string) => {
    setError(null);
    return patch(survey, "rename", { name });
  };

  return { error, actions: { run, rename } };
}
