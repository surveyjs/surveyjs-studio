/** Shown instead of the app when the stored demo data has another data version than this build's. */
export function SandboxOutdated({ onReset }: { onReset: () => void }) {
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
      <button type="button" onClick={onReset}>
        Reset to continue
      </button>
    </div>
  );
}
