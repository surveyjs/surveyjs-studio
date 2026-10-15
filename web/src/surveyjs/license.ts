const applying = new Map<string, Promise<void>>();

/**
 * Applies the SurveyJS licence key. `survey-core` is imported lazily so it stays out of the
 * main chunk. Concurrent calls share one in-flight promise, so a key is applied once; a
 * failed import is forgotten so a later call can retry.
 */
export function applySurveyJSLicense(key: string | null): Promise<void> {
  if (key === null) return Promise.resolve();
  let pending = applying.get(key);
  if (pending === undefined) {
    pending = import("survey-core").then(({ setLicenseKey }) => {
      setLicenseKey(key);
    });
    applying.set(key, pending);
    pending.catch(() => applying.delete(key));
  }
  return pending;
}
