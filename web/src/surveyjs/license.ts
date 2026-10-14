let applied = false;

/** Applies the SurveyJS licence key. `survey-core` is imported lazily so it stays out of the main chunk. */
export async function applySurveyJSLicense(key: string | null): Promise<void> {
  if (key === null || applied) return;
  const { setLicenseKey } = await import("survey-core");
  setLicenseKey(key);
  applied = true;
}
