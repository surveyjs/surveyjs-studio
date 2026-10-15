import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig, type AppConfig } from "./config.js";
import { createProviders } from "./providers/index.js";

let config: AppConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// The app's logger exists only once the app is built; until then warnings are dropped.
let appLog: FastifyBaseLogger | undefined = undefined;
const providers = await createProviders(config, {
  logger: { warn: (details, message) => appLog?.warn(details, message) },
});
const app = await buildApp(config, providers);
appLog = app.log;

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

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  await providers.close();
  process.exit(1);
}
