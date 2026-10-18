import { useState } from "react";
import type { ViewName } from "../api/views";

// The texts, classes and confirm questions of surveyjs.io's two Reset sections (D14).
const SECTIONS: readonly {
  view: ViewName;
  text: string;
  button: string;
  confirm: string;
  done: string;
}[] = [
  {
    view: "table",
    text: "Your custom survey data table will be reset to its default state. Please be aware that the table state reset is irreversible.",
    button: "Reset Table State",
    confirm: "Are you absolutely sure that you want to remove table state ?",
    done: "The table layout is reset.",
  },
  {
    view: "summary",
    text: "Your custom survey data summary will be reset to its default state. Please be aware that the summary state reset is irreversible.",
    button: "Reset Summary State",
    confirm: "Are you absolutely sure that you want to remove summary state ?",
    done: "The summary layout is reset.",
  },
];

const FAILED_TEXT = "The layout was not reset. Please try again.";

/**
 * The Details tab. Step 9 has only its two Reset sections: each asks first, then removes the
 * user's saved layout of that view (`onReset`), so the view opens in its default layout.
 */
export function DetailsTab({ onReset }: { onReset: (view: ViewName) => Promise<void> }) {
  return (
    <>
      {SECTIONS.map((section) => (
        <ResetSection key={section.view} {...section} onReset={onReset} />
      ))}
    </>
  );
}

function ResetSection({
  view,
  text,
  button,
  confirm,
  done,
  onReset,
}: (typeof SECTIONS)[number] & { onReset: (view: ViewName) => Promise<void> }) {
  const [outcome, setOutcome] = useState<"idle" | "resetting" | "done" | "failed">("idle");

  const reset = async () => {
    if (!window.confirm(confirm)) return;
    setOutcome("resetting");
    try {
      await onReset(view);
      setOutcome("done");
    } catch {
      setOutcome("failed");
    }
  };

  return (
    <div className="mod-mt-30">
      <p className="v2-class---paragraph">{text}</p>
      <div>
        <span>
          <button
            className="rounded-button rounded-button--danger"
            type="button"
            disabled={outcome === "resetting"}
            onClick={() => void reset()}
          >
            {button}
          </button>
        </span>
      </div>
      {outcome === "done" && (
        <p className="v2-class---paragraph" role="status">
          {done}
        </p>
      )}
      {outcome === "failed" && (
        <p className="v2-class---paragraph" role="alert">
          {FAILED_TEXT}
        </p>
      )}
    </div>
  );
}
