# Running the app

How to start each configuration that works today, and where each one reads its settings. Commands are for Git Bash or
PowerShell, from the repository root. Setup (Node.js 24, pnpm, Docker) is in [Development](development.md#setup).

## What runs today

Every configuration on this page is **mode 4, development** ([idea §3.0](../idea.md)):

- in-memory data, a local copy of the old surveyjs.io stores in Docker, or (self-hosted track, surveys only so far) a
  SQLite file or PostgreSQL in Docker;
- for the product owner only, two runs on the real production SQL database and storage accounts: mode 1.1's data,
  signing in through a local the site's sign-in service.

Mode 1.1 itself (`https://studio.surveyjs.io`) is the image behind an https proxy and needs the hosting step.
Mode 1.2 is mode 1.1 plus changes on surveyjs.io (its redirects and the account-deleted webhook), so it needs no other
app configuration than the webhook secret. Modes 1.3, 2a, 2b and 3 are not built yet. A real deployment (the image
behind an https proxy, its settings by mode, the rollout) is described in [Operations](operations.md).

| Mode                            | What it is                                                                                         | Start                                                                               | Stop                                                                       | Settings file                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 4, memory demo                  | Data in memory, a "Sign in as…" page, the fixture users                                            | `pnpm demo`, then <http://localhost:5173>                                           | Ctrl+C                                                                     | [`server/demo.env`](../server/demo.env)                                                                   |
| 4, Azurite demo                 | A local copy of the old stores in Docker, the mock sign-in server                                  | `pnpm demo:azurite:up` once, then `pnpm demo:azurite`, then <http://localhost:5173> | Ctrl+C (see [Stopping the Docker services](#stopping-the-docker-services)) | [`docker/azurite.env`](../docker/azurite.env) and [`server/demo-azurite.env`](../server/demo-azurite.env) |
| 4, SQLite                       | Surveys in a SQLite file, the rest in memory (self-hosted Step 1), the "Sign in as…" page          | `pnpm seed:sqlite` once, then `pnpm dev:sqlite`, then <http://localhost:5173>       | Ctrl+C; delete `server/.data/` to start over                               | [`server/demo.env`](../server/demo.env) and [`server/demo-sqlite.env`](../server/demo-sqlite.env)         |
| 4, PostgreSQL                   | Surveys in PostgreSQL in Docker, the rest in memory (self-hosted Step 1), the "Sign in as…" page   | `pnpm seed:postgres` once, then `pnpm dev:postgres`, then <http://localhost:5173>   | Ctrl+C; `pnpm postgres:down` deletes the database                          | [`server/demo.env`](../server/demo.env) and [`docker/postgres.env`](../docker/postgres.env)               |
| 4, prod-like                    | The production image in the mode 1 configuration, on the local copy                                | `pnpm prod-like:up`, then <http://localhost:8080>                                   | `pnpm prod-like:down`                                                      | [`docker/prod-like.env`](../docker/prod-like.env)                                                         |
| 4, development run on real data | The development server and Vite on the production stores, signing in through a local the site's sign-in service | `pnpm dev:prod-data`, then <http://localhost:5173>                                  | Ctrl+C                                                                     | `server/.env` (template [`server/.env.example`](../server/.env.example))                                  |
| 4, the image on real data       | The production image on the production stores, signing in through a local the site's sign-in service            | `pnpm image:prod-data`, then <http://localhost:3000>                                | Ctrl+C                                                                     | `server/.env`                                                                                             |

**The two runs on real data read and write production data.** Everything you do there is real. Both print a "REAL
DATA" banner with the SQL server, the database and the storage accounts they use. Setting them up (the the site's sign-in service
client, the connection strings, the certificate) is described in [Production data mode](development.md#production-data-mode)
and [The image on production data](development.md#the-image-on-production-data). To look without changing anything,
put `READ_ONLY=true` in `server/.env`: every write is then refused with `503 read-only`, while browsing, sign-in and
sign-out still work.

## Changing settings

Edit the settings file of the mode, then start it again. What each variable means is in
[Development › Environment variables](development.md#environment-variables-server); the account settings
(`USER_DIRECTORY`, `ACCOUNT_NOTICES`, the webhook secret) are in [Operations](operations.md#configuring-accounts).

- **`pnpm demo`, `pnpm demo:azurite`, `pnpm dev:sqlite`, `pnpm dev:postgres`, `pnpm dev:prod-data`:** a variable set in the shell wins over the file. For
  example, in Git Bash `LOG_LEVEL=debug pnpm dev:prod-data`; in PowerShell
  `$env:LOG_LEVEL = "debug"; pnpm dev:prod-data` (the variable stays set for the session; remove it with
  `Remove-Item Env:LOG_LEVEL`).
- **`pnpm image:prod-data`:** the container gets `server/.env` only; shell variables do not reach it. The launcher
  always sets `HOST`, `PORT`, `WEB_ROOT`, `PUBLIC_BASE_URL` (`http://localhost:3000`) and the certificate path itself.
  Docker Compose reads the file too and expands `$` in it, so **a value that contains `$` must be in single quotes**,
  from right after the `=` to the end of the line: `LEGACY_SQL_CONNECTION_STRING='Server=…;Password=a$b;…'`. Double
  quotes do not help. The launcher refuses to start and names the variable when a value needs them.
  `pnpm dev:prod-data` reads single-quoted values the same way.
- **`pnpm prod-like:up`:** edit `docker/prod-like.env`. It holds only local placeholder values; never put a real
  connection string or secret in it.
- **`server/.env` is gitignored.** Never commit it, and never put real values in `server/.env.example`.

## Stopping the Docker services

The Azurite demo and prod-like use the same host ports (Azurite 10000 and 10002, SQL Server 14333, the mock sign-in
server 18080), so only one of them can run at a time.

- `pnpm demo:azurite:down` and `pnpm prod-like:down` **delete** their data (`docker compose down -v`), and so does
  `pnpm postgres:down` (PostgreSQL on 127.0.0.1:15432, which runs beside either of them).
- To pause the Azurite demo and keep its data, stop its containers instead:
  `docker compose --env-file docker/azurite.env -f docker/compose.azurite.yaml stop`, and later the same command with
  `start`.
- If you closed the terminal of `pnpm image:prod-data` instead of pressing Ctrl+C, stop it with
  `docker compose -f docker/image-prod-data.yaml down`.
