import { createRegistry, startMetricsServer } from "@surveyjs-studio/metrics";
import { buildBridge } from "./app.js";
import { createBridgeMetrics } from "./metrics.js";
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

// Every request is counted; the numbers are served only on the separate BRIDGE_METRICS_PORT listener.
const registry = createRegistry({ prefix: "surveyjs_bridge_", processMetrics: true });
const app = buildBridge(settings, {
  logger: { level: "info" },
  metrics: createBridgeMetrics(registry),
});

let metricsServer: Awaited<ReturnType<typeof startMetricsServer>> | null = null;
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    Promise.all([app.close(), metricsServer?.close()]).then(
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
    metrics:
      settings.metricsPort === null ? "off" : `${settings.metricsHost}:${settings.metricsPort}`,
  },
  "starting",
);

try {
  if (settings.metricsPort !== null) {
    metricsServer = await startMetricsServer(registry, {
      host: settings.metricsHost,
      port: settings.metricsPort,
    });
  }
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  process.exit(1);
}
