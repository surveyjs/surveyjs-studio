import { useEffect, useRef, useState } from "react";
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
  const bannerRef = useRef<HTMLElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const failedRef = useRef<HTMLSpanElement>(null);
  // The button that has just gone away takes the focus with it; this is where it goes next.
  const [focusNext, setFocusNext] = useState<"reset" | "confirm" | "failed" | null>(null);

  useEffect(() => {
    const onFull = () => setFull(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);

  useEffect(() => {
    const target = { reset: resetRef, confirm: confirmRef, failed: failedRef }[
      focusNext ?? "reset"
    ];
    if (focusNext !== null) target.current?.focus();
  }, [focusNext, confirming, failed]);

  // The editor and the shell give up the height of the banners above the page
  // (`--read-only-banner-height`, `--page-banner-height`).
  useEffect(() => {
    const banner = bannerRef.current;
    if (banner === null || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      let total = 0;
      for (const element of document.querySelectorAll<HTMLElement>("[data-page-banner]")) {
        total += element.offsetHeight;
      }
      root.style.setProperty("--read-only-banner-height", `${total}px`);
      root.style.setProperty("--page-banner-height", `${total}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(banner);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--read-only-banner-height");
      root.style.removeProperty("--page-banner-height");
    };
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
      setFocusNext("failed");
    }
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
      <span role="alert">{full ? FULL_TEXT : null}</span>
      {confirming ? (
        <>
          <span>{CONFIRM_TEXT}</span>
          <button ref={confirmRef} type="button" className={styles.bannerButton} onClick={reset}>
            Reset
          </button>
          <button type="button" className={styles.bannerButton} onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {!full && <span>{DEMO_TEXT}</span>}
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
          <button ref={resetRef} type="button" className={styles.bannerButton} onClick={ask}>
            Reset demo data
          </button>
        </>
      )}
      {failed && (
        <span ref={failedRef} role="alert" tabIndex={-1}>
          {RESET_FAILED_TEXT}
        </span>
      )}
    </aside>
  );
}
