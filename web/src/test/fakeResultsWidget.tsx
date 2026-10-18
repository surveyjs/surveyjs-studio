import type { ResultsWidgetProps } from "../results/ResultsPage";

/** The layout change the fakes' "Change layout" button reports. */
export const changedLayout = { elements: [{ name: "q1", isVisible: false }] };

/**
 * A stand-in for the Summary or the Table (jsdom runs neither the charts nor Tabulator): it shows
 * how many responses, which saved state, private questions and view the page passed, and reports
 * `changedLayout` (when it may) and a new private list (when it may).
 */
export function fakeResultsWidget(testId: string) {
  return function FakeResultsWidget({
    responses,
    savedState,
    onStateChange,
    privateQuestions,
    onPrivateQuestionsChange,
    publicView,
  }: ResultsWidgetProps) {
    return (
      <div data-testid={testId}>
        <p>{responses.length} responses</p>
        <pre data-testid={`${testId}-state`}>{JSON.stringify(savedState)}</pre>
        <pre data-testid={`${testId}-private`}>{JSON.stringify(privateQuestions)}</pre>
        <pre data-testid={`${testId}-public`}>{JSON.stringify(publicView)}</pre>
        {onStateChange !== undefined && (
          <button type="button" onClick={() => onStateChange(changedLayout)}>
            Change layout
          </button>
        )}
        {onPrivateQuestionsChange !== undefined && (
          <button type="button" onClick={() => onPrivateQuestionsChange(["q1"])}>
            Make q1 private
          </button>
        )}
      </div>
    );
  };
}
