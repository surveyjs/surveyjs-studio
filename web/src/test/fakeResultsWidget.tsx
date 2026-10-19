import type { ResultsWidgetProps } from "../results/ResultsPage";

/** The layout change the fakes' "Change layout" button reports. */
export const changedLayout = { elements: [{ name: "q1", isVisible: false }] };

/** The privacy changes the fakes' buttons report, by button label. */
const PRIVACY_BUTTONS = [
  ["Make q1 private", { madePrivate: ["q1"], madePublic: [] }],
  ["Make q2 private", { madePrivate: ["q2"], madePublic: [] }],
  ["Make q2 public", { madePrivate: [], madePublic: ["q2"] }],
] as const;

/**
 * A stand-in for the Summary or the Table (jsdom runs neither the charts nor Tabulator): it shows
 * how many responses, which saved state, private questions and view the page passed, and reports
 * `changedLayout` (when it may) and privacy changes (when it may).
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
        {onPrivateQuestionsChange !== undefined &&
          PRIVACY_BUTTONS.map(([label, change]) => (
            <button key={label} type="button" onClick={() => onPrivateQuestionsChange(change)}>
              {label}
            </button>
          ))}
      </div>
    );
  };
}
