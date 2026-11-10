export interface SandboxSettings {
  /** The largest upload, in KB; a larger file gets `413 quota-exceeded`. */
  readonly maxUploadKb: number;
  /** The document size, in KB, at or above which the sandbox counts as full. */
  readonly storageLimitKb: number;
  /** The largest seed, in KB (CI checks the seed against it). */
  readonly seedBudgetKb: number;
}

export const DEFAULT_SETTINGS: SandboxSettings = {
  maxUploadKb: 200,
  storageLimitKb: 4096,
  seedBudgetKb: 1024,
};

async function fetchSettingsFile(): Promise<unknown> {
  // Next to index.html: below the base path of a sandbox on a sub-path.
  const response = await fetch(`${import.meta.env.BASE_URL}sandbox.config.json`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Reads `sandbox.config.json`, next to `index.html`. Each setting must be a positive integer, else
 * it falls back to its default with a warning naming it. A missing file, a non-JSON body or a
 * non-object falls back entirely, with one warning. Unknown keys are ignored.
 */
export async function loadSandboxSettings(
  fetchJson: () => Promise<unknown> = fetchSettingsFile,
): Promise<SandboxSettings> {
  let raw: unknown;
  try {
    raw = await fetchJson();
  } catch (error) {
    console.warn("sandbox.config.json could not be read; using the default settings.", error);
    return DEFAULT_SETTINGS;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn("sandbox.config.json is not a JSON object; using the default settings.");
    return DEFAULT_SETTINGS;
  }
  const source = raw as Record<string, unknown>;
  const result: { -readonly [K in keyof SandboxSettings]: number } = { ...DEFAULT_SETTINGS };
  for (const name of Object.keys(DEFAULT_SETTINGS) as (keyof SandboxSettings)[]) {
    if (!(name in source)) continue;
    const value = source[name];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) result[name] = value;
    else {
      console.warn(
        `sandbox.config.json: ${name} must be a positive integer; using ${DEFAULT_SETTINGS[name]}.`,
      );
    }
  }
  return result;
}
