import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { surveyQueryOptions, useUpdateSurvey } from "../api/surveys";
import {
  applyPrivacyChange,
  combinePrivacyChanges,
  isNoPrivacyChange,
  NO_PRIVACY_CHANGE,
  type PrivacyChange,
} from "./privacy";
import { createViewSaver, type ViewSaver } from "./viewSaver";

export interface PrivateQuestionsSaver {
  /** A change the Summary made: one save at a time; changes made meanwhile go out together next. */
  change(change: PrivacyChange): void;
  /** The last save failed (until a later one succeeds). */
  failed: boolean;
}

/**
 * Saves the user's changes of the survey's private-question list (`settings.privateResultQuestions`).
 * Each save reads the list again, applies only the names this user changed and sends the result, so
 * a Summary opened earlier (another tab, another editor) never undoes what someone else saved.
 * When the read fails or answers without a list (the server could not read it), nothing is sent:
 * the save fails, and its changes go out again with the next one. Built on the layout saver without
 * a delay: one save is in flight, and changes made meanwhile wait and are combined.
 */
export function usePrivateQuestionsSaver(surveyId: string): PrivateQuestionsSaver {
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateSurvey();
  const mutate = useRef(mutateAsync);
  useEffect(() => {
    mutate.current = mutateAsync;
  }, [mutateAsync]);
  const [failed, setFailed] = useState(false);
  const saver = useRef<ViewSaver | null>(null);
  /** The changes not sent yet (the newest wins for a name changed twice). */
  const unsent = useRef<PrivacyChange>(NO_PRIVACY_CHANGE);

  // Built in the effect: Strict Mode runs it twice, and the first saver is closed on cleanup.
  useEffect(() => {
    unsent.current = NO_PRIVACY_CHANGE;
    const created = createViewSaver({
      delayMs: 0,
      save: async () => {
        const change = unsent.current;
        unsent.current = NO_PRIVACY_CHANGE;
        if (isNoPrivacyChange(change)) return;
        try {
          const fresh = await queryClient.fetchQuery({
            ...surveyQueryOptions(surveyId),
            staleTime: 0,
          });
          const names = fresh.settings.privateResultQuestions;
          if (names === undefined) throw new Error("The private-question list cannot be read.");
          await mutate.current({
            survey: fresh,
            patch: { settings: { privateResultQuestions: applyPrivacyChange(names, change) } },
          });
        } catch (error) {
          // Sent again with the next change, under any newer change of the same names.
          unsent.current = combinePrivacyChanges(change, unsent.current);
          throw error;
        }
      },
      onError: () => setFailed(true),
      onSaved: () => setFailed(false),
    });
    saver.current = created;
    return () => {
      if (saver.current === created) saver.current = null;
      void created.close();
    };
  }, [surveyId, queryClient]);

  const change = useCallback((next: PrivacyChange) => {
    if (isNoPrivacyChange(next)) return;
    unsent.current = combinePrivacyChanges(unsent.current, next);
    saver.current?.change({});
  }, []);
  return { change, failed };
}
