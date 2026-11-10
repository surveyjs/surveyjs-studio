import { useEffect, useRef, useState } from "react";
import { navigateTo } from "../navigation";
import { OUTDATED_EVENT, STORAGE_FULL_EVENT } from "./handlers/problems";
import styles from "./sandbox.module.css";
import { RESET_FAILED_TEXT } from "./SandboxOutdated";
import { sandboxStore } from "./start";
import { setSessionCookie, STORAGE_WRITTEN_EVENT } from "./store";
import { StorageBusyError } from "./tab-lock";

export const DEMO_TEXT =
  "This is a demo. Your data stays in this browser, and other visitors don't see it.";
export const FULL_TEXT = "Browser storage is full. Reset the demo data to continue.";
export const OUTDATED_TEXT = "The demo was updated in another tab. Reload this page.";
const CONFIRM_TEXT = "Reset all demo data? Your changes in this browser are lost.";
const RESET_BUSY_TEXT = "Another tab is saving the demo data. Try the reset again.";
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
  const [outdated, setOutdated] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const bannerRef = useRef<HTMLElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const failedRef = useRef<HTMLSpanElement>(null);
  // The button that has just gone away takes the focus with it; this is where it goes next.
  const [focusNext, setFocusNext] = useState<"reset" | "confirm" | "failed" | null>(null);

  useEffect(() => {
    const onFull = () => setFull(true);
    // A write that is stored proves there is room again (say, after deleting surveys).
    const onWritten = () => setFull(false);
    // Stays until the page is reloaded: the data this page holds is out of date.
    const onOutdated = () => setOutdated(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    window.addEventListener(OUTDATED_EVENT, onOutdated);
    window.addEventListener(STORAGE_WRITTEN_EVENT, onWritten);
    return () => {
      window.removeEventListener(STORAGE_FULL_EVENT, onFull);
      window.removeEventListener(OUTDATED_EVENT, onOutdated);
      window.removeEventListener(STORAGE_WRITTEN_EVENT, onWritten);
    };
  }, []);

  useEffect(() => {
    const target = { reset: resetRef, confirm: confirmRef, failed: failedRef }[
      focusNext ?? "reset"
    ];
    if (focusNext !== null) target.current?.focus();
  }, [focusNext, confirming, failed]);

  // The self-hosted shell and its editor give up the height of the banners above the page
  // (`--page-banner-height`). `--read-only-banner-height` is the read-only banner's own, not set here.
  useEffect(() => {
    const banner = bannerRef.current;
    if (banner === null || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      let total = 0;
      for (const element of document.querySelectorAll<HTMLElement>("[data-page-banner]")) {
        total += element.offsetHeight;
      }
      root.style.setProperty("--page-banner-height", `${total}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(banner);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--page-banner-height");
    };
  }, []);

  const reset = async () => {
    try {
      await sandboxStore().reset();
    } catch (error) {
      // The browser may refuse the write too (StorageFullError); then all that is left is to say so.
      setConfirming(false);
      setFailed(error instanceof StorageBusyError ? RESET_BUSY_TEXT : RESET_FAILED_TEXT);
      setFocusNext("failed");
      return;
    }
    setSessionCookie(null);
    navigateTo("/sign-in");
  };

  const ask = () => {
    setConfirming(true);
    setFocusNext("confirm");
  };
  const cancel = () => {
    setConfirming(false);
    setFocusNext("reset");
  };

  return (
    <aside
      ref={bannerRef}
      aria-label="Demo notice"
      data-page-banner
      className={`${styles.banner} ${compact ? styles.compact : ""}`}
    >
      {/* Present from the start, so a screen reader announces the text when it appears. */}
      <span role="alert">{outdated ? OUTDATED_TEXT : full ? FULL_TEXT : null}</span>
      {outdated && (
        <button type="button" className={styles.bannerButton} onClick={() => location.reload()}>
          Reload
        </button>
      )}
      {confirming ? (
        <>
          <span>{CONFIRM_TEXT}</span>
          <button
            ref={confirmRef}
            type="button"
            className={styles.bannerButton}
            onClick={() => void reset()}
          >
            Reset
          </button>
          <button type="button" className={styles.bannerButton} onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {!full && !outdated && <span>{DEMO_TEXT}</span>}
          {!compact && !full && !outdated && (
            <>
              <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer">
                Run it yourself
              </a>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                Source code
              </a>
            </>
          )}
          <button ref={resetRef} type="button" className={styles.bannerButton} onClick={ask}>
            Reset demo data
          </button>
        </>
      )}
      {failed !== null && (
        <span ref={failedRef} role="alert" tabIndex={-1}>
          {failed}
        </span>
      )}
    </aside>
  );
}
