import styles from "./ReadOnlyBanner.module.css";

export const READ_ONLY_TEXT = "My Surveys is read-only at the moment. Changes cannot be saved.";

/**
 * Shown at the top of every page while the server runs with `READ_ONLY=true`. It lives in the root
 * route, not in a shell, because the run page has no shell.
 */
export function ReadOnlyBanner() {
  return (
    <div className={styles.banner} data-page-banner role="status" title={READ_ONLY_TEXT}>
      {READ_ONLY_TEXT}
    </div>
  );
}
