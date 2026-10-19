import type { ResultsWidgetProps } from "../results/ResultsPage";

/** The layout change the fakes' "Change layout" button reports. */
export const changedLayout = { elements: [{ name: "q1", isVisible: false }] };

/**
 * A stand-in for the Summary or the Table (jsdom runs neither the charts nor Tabulator): it shows
 * how many responses and which saved state the page passed, and reports `changedLayout`.
 */
export function fakeResultsWidget(testId: string) {
  return function FakeResultsWidget({ responses, savedState, onStateChange }: ResultsWidgetProps) {
    return (
      <div data-testid={testId}>
        <p>{responses.length} responses</p>
        <pre data-testid={`${testId}-state`}>{JSON.stringify(savedState)}</pre>
        <button type="button" onClick={() => onStateChange(changedLayout)}>
          Change layout
        </button>
      </div>
    );
  };
}
