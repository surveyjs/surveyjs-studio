import { useState } from "react";

/** Shown when a reset of the demo data fails (the browser refused the write, or another tab kept the lock). */
export const RESET_FAILED_TEXT =
  "Could not reset the demo data. Try again, or clear this site's data in the browser and reload.";

/**
 * Shown instead of the app when the stored demo data has another data version than this build's.
 * `onReset` resolves when the page reloads; a rejection (or a throw) is told on the page, which
 * keeps the button.
 */
export function SandboxOutdated({ onReset }: { onReset: () => Promise<void> | void }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onReset();
    } catch (error) {
      console.error("The demo data could not be reset.", error);
      setFailed(true);
    } finally {
      setBusy(false);
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
      <button type="button" disabled={busy} onClick={() => void reset()}>
        Reset to continue
      </button>
    </div>
  );
}
