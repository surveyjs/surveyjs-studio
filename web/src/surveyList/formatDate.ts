/** A list date in US short form, for example `4/14/2026`, in the browser's time zone by default. */
export function formatListDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}
