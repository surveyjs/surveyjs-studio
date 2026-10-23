import type { FastifyBaseLogger } from "fastify";
import type { ProviderSet, ReadinessCheck, ReadinessName } from "./providers/types.js";
import { safeErrorCategory } from "./safe-error.js";

/**
 * How long a `/readyz` answer is reused, failures included. `/readyz` is not rate limited, so
 * however often it is called, the stores see at most one check per this many milliseconds.
 */
export const READINESS_CACHE_MS = 5_000;

export interface ReadinessAnswer {
  /** The names of the failed checks; empty when ready. */
  readonly failing: readonly ReadinessName[];
}

export interface Readiness {
  check(): Promise<ReadinessAnswer>;
}

/**
 * Runs the providers' checks for `/readyz`. Concurrent callers share one run, and its answer is
 * reused for `READINESS_CACHE_MS`. A check that starts or stops failing logs one `warn` line with
 * its name and a safe category (never an error text).
 */
export function createReadiness(
  providers: Pick<ProviderSet, "ready" | "readinessNames">,
  log: FastifyBaseLogger,
  now: () => number = Date.now,
): Readiness {
  const failingNow = new Set<ReadinessName>();
  let inFlight: Promise<ReadinessAnswer> | null = null;
  let cached: { readonly answer: ReadinessAnswer; readonly at: number } | null = null;

  async function run(): Promise<ReadinessAnswer> {
    // A check that cannot run counts as failed, and the answer never names less than all of them.
    const checks: readonly ReadinessCheck[] = await providers.ready().catch((error: unknown) => {
      const reason = safeErrorCategory(error);
      return providers.readinessNames.map((name) => ({ name, ok: false, reason }));
    });
    for (const check of checks) {
      if (!check.ok && !failingNow.has(check.name)) {
        failingNow.add(check.name);
        log.warn({ check: check.name, reason: check.reason ?? "error" }, "readiness check failing");
      } else if (check.ok && failingNow.delete(check.name)) {
        log.warn({ check: check.name }, "readiness check ok again");
      }
    }
    return { failing: checks.filter((check) => !check.ok).map((check) => check.name) };
  }

  return {
    check() {
      if (cached !== null && now() - cached.at < READINESS_CACHE_MS) {
        return Promise.resolve(cached.answer);
      }
      inFlight ??= run()
        .then((answer) => {
          cached = { answer, at: now() };
          return answer;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
