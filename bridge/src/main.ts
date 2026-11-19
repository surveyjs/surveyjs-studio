import { buildBridge } from "./app.js";
import { loadSettings, SettingsError, type BridgeSettings } from "./settings.js";

let settings: BridgeSettings;
try {
  settings = loadSettings(process.env);
} catch (error) {
  if (error instanceof SettingsError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const app = buildBridge(settings, { logger: { level: "info" } });

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, "error during shutdown");
        process.exit(1);
      },
    );
  });
}

app.log.info(
  {
    studioUrl: settings.studioUrl,
    legacyUrl: settings.legacyUrl,
    cacheEntries: settings.cacheEntries,
    studioTimeoutMs: settings.studioTimeoutMs,
    fileTimeoutMs: settings.fileTimeoutMs,
    trustProxy: settings.trustProxy,
  },
  "starting",
);

try {
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  process.exit(1);
}
