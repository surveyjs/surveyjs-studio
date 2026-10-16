/** A list date in US short form, for example `4/14/2026`, in the browser's time zone by default. */
export function formatListDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

/** A history time with date, time and zone, for example `4/14/2026, 3:30 PM UTC`. */
export function formatHistoryTime(iso: string, timeZone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(iso));
}
