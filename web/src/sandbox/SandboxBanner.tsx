import { useEffect, useState } from "react";
import { navigateTo } from "../navigation";
import { STORAGE_FULL_EVENT } from "./handlers/problems";
import styles from "./sandbox.module.css";
import { sandboxStore } from "./start";
import { setSessionCookie } from "./store";

export const DEMO_TEXT =
  "This is a demo. Your data stays in this browser, and other visitors don't see it.";
export const FULL_TEXT = "Browser storage is full. Reset the demo data to continue.";
const CONFIRM_TEXT = "Reset all demo data? Your changes in this browser are lost.";
const RESET_FAILED_TEXT =
  "Could not reset the demo data. Clear this site's data in the browser and reload.";
const SELF_HOSTING_URL =
  "https://github.com/surveyjs/surveyjs-studio/blob/master/docs/self-hosting.md";
const SOURCE_URL = "https://github.com/surveyjs/surveyjs-studio";

function storageIsFull(): boolean {
  try {
    return sandboxStore().isFull();
  } catch {
    return false;
  }
}

/**
 * The strip at the top of every page of the sandbox build: what the demo is, two links, and Reset
 * demo data (asks first). When a write is refused because the storage is full (`sandbox:storage-full`,
 * or already full at the start) it says so instead. `compact` (the run page, which a respondent
 * sees) drops the links.
 */
export function SandboxBanner({ compact = false }: { compact?: boolean }) {
  const [full, setFull] = useState(storageIsFull);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onFull = () => setFull(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);

  const reset = () => {
    try {
      sandboxStore().reset();
      setSessionCookie(null);
      navigateTo("/sign-in");
    } catch {
      // The browser may refuse the write too; nothing is left to do but say so.
      setConfirming(false);
      setFailed(true);
    }
  };

  return (
    <div
      className={`${styles.banner} ${compact ? styles.compact : ""}`}
      role={full ? "alert" : "status"}
    >
      {confirming ? (
        <>
          <span>{CONFIRM_TEXT}</span>
          <button type="button" className={styles.bannerButton} onClick={reset}>
            Reset
          </button>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span>{full ? FULL_TEXT : DEMO_TEXT}</span>
          {!compact && !full && (
            <>
              <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer">
                Run it yourself
              </a>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                Source code
              </a>
            </>
          )}
          <button type="button" className={styles.bannerButton} onClick={() => setConfirming(true)}>
            Reset demo data
          </button>
        </>
      )}
      {failed && <span role="alert">{RESET_FAILED_TEXT}</span>}
    </div>
  );
}
