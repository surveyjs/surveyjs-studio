import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveResultsView, type ViewName, type ViewState } from "../api/views";
import { createViewSaver, type ViewSaver } from "./viewSaver";

export interface ViewSaverHandle {
  /** A new state of the view: saved after the debounce delay. */
  change(state: ViewState): void;
  /** Sends a waiting state now; resolves when every save started so far has ended. */
  flush(): Promise<void>;
  /** Drops a waiting state; resolves when a save in flight has ended. */
  cancel(): Promise<void>;
  /** The last save failed (until a later one succeeds). */
  failed: boolean;
}

/**
 * Saves one view of the survey for the user while the page is open: debounced, one request at a
 * time (`createViewSaver`). A waiting state is sent when the component unmounts and when the page
 * is hidden (`pagehide`: the tab closes, reloads or goes to another site).
 */
export function useViewSaver(surveyId: string, view: ViewName): ViewSaverHandle {
  const [failed, setFailed] = useState(false);
  const saver = useRef<ViewSaver | null>(null);

  // Built in the effect: Strict Mode runs it twice, and the first saver is closed on cleanup.
  useEffect(() => {
    const created = createViewSaver({
      save: (state) => saveResultsView(surveyId, view, state),
      onError: () => setFailed(true),
      onSaved: () => setFailed(false),
    });
    saver.current = created;
    const sendWaiting = () => void created.flush();
    window.addEventListener("pagehide", sendWaiting);
    return () => {
      window.removeEventListener("pagehide", sendWaiting);
      if (saver.current === created) saver.current = null;
      void created.close();
    };
  }, [surveyId, view]);

  const change = useCallback((state: ViewState) => saver.current?.change(state), []);
  const flush = useCallback(() => saver.current?.flush() ?? Promise.resolve(), []);
  const cancel = useCallback(() => saver.current?.cancel() ?? Promise.resolve(), []);
  return useMemo(() => ({ change, flush, cancel, failed }), [change, flush, cancel, failed]);
}
