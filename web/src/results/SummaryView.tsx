import { useEffect, useRef } from "react";
import { Dashboard, VisualizationManager, WordCloud } from "survey-analytics";
import "survey-analytics/survey.analytics.css";
import { Model } from "survey-core";
import type { ViewState } from "../api/views";
import { type ElementsState, reconcileElementsState } from "./elementsState";
import { createPrivateList, withPrivacy } from "./privacy";
import type { ResultsWidgetProps } from "./ResultsPage";
import { summaryData } from "./tableRows";

// As surveyjs.io (R25): text questions get no word cloud. Removing the WordCloud visualizer for
// every question type leaves the library's Text visualizer (a list of the answers) for text,
// comment and multiple-text questions. Done once, when this module first loads.
VisualizationManager.unregisterVisualizer(undefined, WordCloud);

/**
 * The Summary tab: a SurveyJS Dashboard with a chart per question (all questions, with the
 * library's question chooser, hide and drag-to-reorder). This module is the only one that imports
 * the Dashboard and its styles, so the results page loads them on demand. Built once per mount
 * with the saved state applied before it renders, so loading a layout never saves it again.
 */
export function SummaryView({
  definition,
  responses,
  savedState,
  onStateChange,
  privateQuestions,
  onPrivateQuestionsChange,
}: ResultsWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  // The state at mount: later changes of the prop come from this widget itself.
  const initialState = useRef(savedState);
  const stateCallback = useRef(onStateChange);
  const privacyCallback = useRef(onPrivateQuestionsChange);
  useEffect(() => {
    stateCallback.current = onStateChange;
    privacyCallback.current = onPrivateQuestionsChange;
  }, [onStateChange, onPrivateQuestionsChange]);
  // The latest private list, from the survey setting at mount: later changes of the prop come from
  // this widget itself, and a hidden private chart stays in it.
  const privateList = useRef<ReturnType<typeof createPrivateList> | null>(null);
  privateList.current ??= createPrivateList(privateQuestions);
  const allowPrivacy = onPrivateQuestionsChange !== undefined;

  // Built in the effect, not during render: Strict Mode runs effects twice, and the Dashboard
  // holds a layout engine and listeners that only `destroy` releases.
  useEffect(() => {
    const target = container.current;
    if (target === null) return;
    const survey = new Model(definition);
    const dashboard = new Dashboard({
      questions: survey.getAllQuestions(),
      data: summaryData(responses),
      survey,
      showToolbar: true,
      allowMakeQuestionsPrivate: allowPrivacy,
    });
    // Reconciled against the default state, as the Table does: the setter keeps only the elements
    // it is given, so a question added after the save would otherwise be neither drawn nor offered.
    // Before render: the setter does not raise onStateChanged, and the first render shows it.
    const defaults = dashboard.state as unknown as ElementsState;
    const reconciled = reconcileElementsState(initialState.current, defaults);
    // With the toggle on, every element carries the survey private flag, also without a saved state.
    const state = allowPrivacy
      ? withPrivacy(reconciled ?? defaults, privateList.current!.current())
      : reconciled;
    if (state !== null) dashboard.state = state as unknown as Dashboard["state"];
    dashboard.render(target);
    if (stateCallback.current !== undefined) {
      dashboard.onStateChanged.add((_, changed: ViewState) => stateCallback.current?.(changed));
    }
    if (allowPrivacy) {
      // The library calls this after "Make private" / "Make public".
      dashboard.onPermissionsChangedCallback = (panel: {
        permissions: readonly { name: string; isPublic: boolean }[];
      }) => privacyCallback.current?.(privateList.current!.update(panel.permissions));
    }
    return () => {
      dashboard.destroy();
      survey.dispose();
    };
  }, [definition, responses, allowPrivacy]);

  return <div ref={container} />;
}
