import { useState } from "react";

/** Shown when a reset of the demo data throws (the browser refuses the write). */
export const RESET_FAILED_TEXT =
  "Could not reset the demo data. Clear this site's data in the browser and reload.";

/**
 * Shown instead of the app when the stored demo data has another data version than this build's.
 * `onReset` throws when the reset fails: the page then says so and keeps the button.
 */
export function SandboxOutdated({ onReset }: { onReset: () => void }) {
  const [failed, setFailed] = useState(false);
  const reset = () => {
    try {
      onReset();
      setFailed(false);
    } catch (error) {
      console.error("The demo data could not be reset.", error);
      setFailed(true);
    }
  };
  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: "40rem",
        margin: "3rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>This demo has been updated</h1>
      <p>
        Your demo data was saved by another version of this demo and cannot be opened by this one.
        Reset it to continue with the new demo data.
      </p>
      {/* Present from the start, so a screen reader announces the text when it appears. */}
      <p role="alert">{failed ? RESET_FAILED_TEXT : null}</p>
      <button type="button" onClick={reset}>
        Reset to continue
      </button>
    </div>
  );
}
