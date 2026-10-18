import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { surveyKeys, useUpdateSurvey, type Survey } from "../api/surveys";
import { createViewSaver, type ViewSaver } from "./viewSaver";

export interface PrivateQuestionsSaver {
  /** The new full list of private questions: one save at a time, the latest list wins. */
  change(names: string[]): void;
  /** The last save failed (until a later one succeeds). */
  failed: boolean;
}

/**
 * Saves the survey's private-question list (`settings.privateResultQuestions`) as the Summary
 * changes it. Built on the layout saver without a delay: one PATCH is in flight, and changes made
 * meanwhile collapse into the newest list.
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

  // Built in the effect: Strict Mode runs it twice, and the first saver is closed on cleanup.
  useEffect(() => {
    const created = createViewSaver({
      delayMs: 0,
      save: async ({ names }) => {
        await mutate.current({
          survey: queryClient.getQueryData<Survey>(surveyKeys.detail(surveyId))!,
          patch: { settings: { privateResultQuestions: names as string[] } },
        });
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

  const change = useCallback((names: string[]) => saver.current?.change({ names }), []);
  return { change, failed };
}
