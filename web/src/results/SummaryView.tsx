import { useEffect, useRef } from "react";
import { Dashboard, VisualizationManager, WordCloud } from "survey-analytics";
import "survey-analytics/survey.analytics.css";
import { Model } from "survey-core";
import type { ViewState } from "../api/views";
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
}: ResultsWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  // The state at mount: later changes of the prop come from this widget itself.
  const initialState = useRef(savedState);
  const stateCallback = useRef(onStateChange);
  useEffect(() => {
    stateCallback.current = onStateChange;
  }, [onStateChange]);

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
      allowMakeQuestionsPrivate: false,
    });
    // Before render: the setter does not raise onStateChanged, and the first render shows it.
    if (initialState.current !== null) dashboard.state = initialState.current as Dashboard["state"];
    dashboard.render(target);
    dashboard.onStateChanged.add((_, state: ViewState) => stateCallback.current(state));
    return () => {
      dashboard.destroy();
      survey.dispose();
    };
  }, [definition, responses]);

  return <div ref={container} />;
}
