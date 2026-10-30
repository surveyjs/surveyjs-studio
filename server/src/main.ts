import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig, type AppConfig } from "./config.js";
import { publicUrlWarning, s3EndpointWarning, startupSummary, storageWarning } from "./logging.js";
import { createProviders, type ProviderSet } from "./providers/index.js";
import { PendingMigrationsError } from "./providers/sql.js";
import { withSessionSecret } from "./session-secret.js";
import { DatabaseTooNewError, MigrationMismatchError } from "./sql/migrator.js";

let config: AppConfig;
try {
  config = loadConfig(await withSessionSecret(process.env));
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// The app's logger exists only once the app is built; until then warnings are dropped.
let appLog: FastifyBaseLogger | undefined = undefined;
let providers: ProviderSet;
try {
  providers = await createProviders(config, {
    logger: { warn: (details, message) => appLog?.warn(details, message) },
  });
} catch (error) {
  // A database this version must not use: its message says why and what to do.
  if (
    error instanceof DatabaseTooNewError ||
    error instanceof MigrationMismatchError ||
    error instanceof PendingMigrationsError
  ) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
const app = await buildApp(config, providers);
appLog = app.log;
if (config.sessionSecretIsDevDefault) {
  app.log.warn("SESSION_SECRET is not set: using the development-only session secret");
}
const storage = storageWarning(config);
if (storage !== null) app.log.warn(storage);
const publicUrl = publicUrlWarning(config);
if (publicUrl !== null) app.log.warn(publicUrl);
const s3Endpoint = s3EndpointWarning(config);
if (s3Endpoint !== null) app.log.warn(s3Endpoint);

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

app.log.info(startupSummary(config), "starting");

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  await providers.close();
  process.exit(1);
}
