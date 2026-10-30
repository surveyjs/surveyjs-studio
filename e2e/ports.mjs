// The ports of each e2e configuration, in one place: the Playwright configs build their URLs from
// them and the runner scripts check that they are free before anything starts.

/** Every port a configuration may use. */
export const ports = {
  /** The tsx server of the functional run. */
  server: 3000,
  /** The server of the licence-notice spec. */
  licenceServer: 3001,
  /** The preview of the functional run (and the image of the image target). */
  web: 5173,
  /** The preview of the licence-notice spec (and its image). */
  licenceWeb: 5174,
  /** The server and the preview of the visual run. */
  visualServer: 3002,
  visualWeb: 5175,
  /** The server and the preview of the self-hosted shell's visual run. */
  selfHostedVisualServer: 3003,
  selfHostedVisualWeb: 5176,
};

/**
 * The ports `playwright.config.ts` uses for this run: the tsx target (default) 3000, 3001, 5173 and
 * 5174; Azurite and the SQL modes on it 3000 and 5173; the image target 5173 and 5174 (Azurite and
 * the SQL modes: 5173 only).
 */
export function functionalPorts({ image, azurite, sql = false }) {
  if (image) return azurite || sql ? [ports.web] : [ports.web, ports.licenceWeb];
  if (azurite || sql) return [ports.server, ports.web];
  return [ports.server, ports.licenceServer, ports.web, ports.licenceWeb];
}

/** The ports of `pnpm e2e:visual:self-hosted`. */
export const selfHostedVisualPorts = [ports.selfHostedVisualServer, ports.selfHostedVisualWeb];

/** The ports of `pnpm e2e:visual`. */
export const visualPorts = [ports.visualServer, ports.visualWeb];

/** Whether the arguments pick the Azurite config (`--config playwright.azurite.config.ts`). */
export function usesAzuriteConfig(args) {
  return args.some((arg) => /(^|[\\/=])playwright\.azurite\.config(\.[cm]?[jt]s)?$/.test(arg));
}

/**
 * Whether the arguments pick a SQL config (`--config playwright.sqlite.config.ts`, `postgres`,
 * `password` or `self-hosted`).
 */
export function usesSqlConfig(args) {
  return args.some((arg) =>
    /(^|[\\/=])playwright\.(sqlite|postgres|password|self-hosted)\.config(\.[cm]?[jt]s)?$/.test(
      arg,
    ),
  );
}
