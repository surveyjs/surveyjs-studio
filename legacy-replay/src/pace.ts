// Every replayed request reaches Studio from the operator's one address, so the replay keeps each
// of Studio's per-address limit classes below its rate (ADR 0041 point 3): the requests of a class
// are spaced 60 000 / perMinute ms apart. The replay runs one request at a time.
import type { RateLimitClass } from "../../server/src/rate-limit-classes.js";

export type Pacer = (limit: RateLimitClass | null) => Promise<void>;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Waits as long as the class's last request needs; an action without a limit class never waits. */
export function createPacer(
  limits: Record<RateLimitClass, number>,
  clock: Clock = realClock,
): Pacer {
  const spacing = {} as Record<RateLimitClass, number>;
  for (const [limitClass, perMinute] of Object.entries(limits) as [RateLimitClass, number][]) {
    if (!(Number.isFinite(perMinute) && perMinute > 0)) {
      throw new RangeError(
        `the ${limitClass} limit must be a positive number of requests a minute`,
      );
    }
    spacing[limitClass] = 60_000 / perMinute;
  }
  const next: Record<RateLimitClass, number> = {
    public: -Infinity,
    file: -Infinity,
    summary: -Infinity,
  };
  return async (limit) => {
    if (limit === null) return;
    const now = clock.now();
    const at = Math.max(now, next[limit]);
    next[limit] = at + spacing[limit];
    if (at > now) await clock.sleep(at - now);
  };
}
