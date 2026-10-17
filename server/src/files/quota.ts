/** Bytes a survey may still store: `quota − used`, never below 0. */
export function remainingQuota(quota: number, used: number): number {
  return Math.max(0, quota - used);
}

const KB = 1024;
const MB = 1024 * 1024;

/** One decimal at most, without a trailing `.0`. */
const oneDecimal = (value: number): string => String(Math.round(value * 10) / 10);

/** A size for people (R17): `50 MB`, `1.5 MB`, `64 KB`, `500 bytes`. */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${oneDecimal(bytes / MB)} MB`;
  if (bytes >= KB) return `${oneDecimal(bytes / KB)} KB`;
  return `${bytes} bytes`;
}
