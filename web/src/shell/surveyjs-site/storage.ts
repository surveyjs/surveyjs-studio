// The site keeps the cookie consent and the licence-dialog dismissals in localStorage. The same keys
// are used here, so a choice made on surveyjs.io also counts in My Surveys when both share an origin.
// Storage can be missing or throw (private windows, blocked site data): then nothing is remembered.

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the banner or dialog shows again on the next visit.
  }
}
