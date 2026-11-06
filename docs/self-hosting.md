# Self-hosting

For admins who run SurveyJS Studio on their own server with the free Docker image (mode 2b). It covers the first start,
the settings you set, running behind an https proxy, PostgreSQL and S3, backups, upgrades and the Compose examples.

**The image.** Until the image is published on Docker Hub, release builds go to a private test package,
`ghcr.io/surveyjs/surveyjs-studio-selfhosted-test` (pulling it needs `docker login ghcr.io` with a GitHub token that
has `read:packages`). From a clone of the repository, `pnpm image:build:self-hosted` builds the same image as
`surveyjs-studio:self-hosted`. The commands below write `<image>` for either.

| Item    | Value                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------- |
| Port    | `8080`                                                                                         |
| Data    | the volume `/data`: the SQLite database, uploaded files, the session secret and local backups  |
| User    | `node`, uid 1000 (never root)                                                                  |
| Health  | `GET /healthz` (the process runs; the image's health check), `GET /readyz` (the stores answer) |
| Tags    | `vX.Y.Z`, `vX.Y` (the latest patch of a minor version) and `latest`; platforms amd64 and arm64 |
| Command | `surveyjs-studio`: `backup`, `restore`, `migrate`, `status`, `seed`, `s3-bucket`               |

The container keeps no state: everything lives in `/data` (or in your PostgreSQL and S3). Removing the container and
running it again loses nothing.

## Quick start

One command starts a working service with a built-in database:

```sh
docker run -d --name surveyjs-studio -p 8080:8080 -v surveyjs-studio:/data <image>
```

Then create the first administrator, in one of two ways:

- **The setup link.** With no administrator yet, the server writes a one-time link to its log. Run
  `docker logs surveyjs-studio`, open the link in the line `Open this one-time link to create the first one: …`, and choose the
  email, name and password there. The link works once and only in this process: after a restart the log shows a new one.
- **`ADMIN_EMAIL` and `ADMIN_PASSWORD`.** The server creates that administrator at start-up; the password must be
  changed at the first sign-in. Pass the password by name, so it stays out of the command line and the shell history:

  ```sh
  read -rsp "First admin password (12+ characters): " ADMIN_PASSWORD; echo; export ADMIN_PASSWORD
  docker run -d --name surveyjs-studio -p 8080:8080 -v surveyjs-studio:/data \
    -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD <image>
  ```

Open <http://localhost:8080> and sign in. On a real server, set `PUBLIC_BASE_URL` too ([below](#behind-a-reverse-proxy)):
until you do, the setup and set-password links, the sign-out redirect and the addresses stored for uploaded files say
`localhost`, and the log warns `PUBLIC_BASE_URL is http://localhost:8080: …` at every start. Set it before anyone uploads a
file: files uploaded under a wrong address stay broken after you fix it.

**A host folder instead of a volume.** A named volume (as above) needs nothing. A host folder (`-v /srv/surveyjs:/data`)
must be writable by uid 1000: `sudo chown 1000:1000 /srv/surveyjs`. Otherwise, while `SESSION_SECRET` is unset (the image
default), the server stops at start-up with one line that names the folder and uid 1000. With `SESSION_SECRET` set, the
session secret needs no file, and the first write to `/data` (the database) fails with its own error.

**Changing a setting.** A container keeps the environment it was created with. Stop and remove it, then run it again
with the new settings and the same volume. Put many settings in an env file (`--env-file /etc/surveyjs-studio.env`,
`chmod 600`), one `NAME=value` per line, without quotes.

## Settings

The image sets everything else: SQLite on `/data`, local files, password sign-in, local accounts, the self-hosted look,
port 8080 and a session secret it creates once in `/data/session-secret`. Every variable, with its default, is in
[Development › Environment variables](development.md#environment-variables-server).

| Variable                           | What it does                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PUBLIC_BASE_URL`                  | The address people open, e.g. `https://surveys.example.com` (no path). Default `http://localhost:8080` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`    | The first administrator, created once while there is none ([Quick start](#quick-start))                |
| `BRAND_NAME`, `BRAND_LOGO_URL`     | Your instance's name and logo (an https URL, or a path your proxy serves)                              |
| `BRAND_ACCENT_COLOR`               | `#rgb` or `#rrggbb`                                                                                    |
| `TERMS_URL`, `PRIVACY_URL`         | The Terms and Privacy links in the footer                                                              |
| `BRANDING`                         | `on` (default) or `off`; `off` hides "Powered by SurveyJS" and needs your own licence key              |
| `SURVEYJS_LICENSE_KEY`             | Your own SurveyJS licence key; without it the app uses the image's key (shown with the branding)       |
| `TRUST_PROXY`                      | The address of your reverse proxy, as the container sees it ([below](#behind-a-reverse-proxy))         |
| `STORAGE_PROVIDER`, `DATABASE_URL` | `postgres` and a `postgres://` URL to use PostgreSQL ([below](#postgresql))                            |
| `FILE_STORE`, `S3_*`               | `s3` and the bucket's settings to keep uploaded files in S3 ([below](#s3))                             |
| `LIMIT_MAX_FILE_BYTES`             | The largest file a respondent can upload; default 10 MB                                                |
| `LIMIT_MAX_ASSET_BYTES_PER_SURVEY` | The total size of the images and files of one survey's editor uploads; default 50 MB                   |
| `LIMIT_MAX_RESPONSE_BYTES`         | The largest response; default 1 MB                                                                     |
| `LIMIT_MAX_DOCUMENT_BYTES`         | The largest survey definition or theme; default 30 MB                                                  |

Branding in detail: [Branding and the licence key](customizing/branding.md).

The licences of the components in the image are in `/app/THIRD_PARTY_NOTICES.md` ([how it is built](customizing/licensing.md#third-party-notices)).

## Sign in with Google and others

The image signs people in with an email and a password. To add Google, GitHub or Facebook, create an OAuth app at the
provider, give it the redirect address `<PUBLIC_BASE_URL>/api/v1/auth/callback`, and set `AUTH_METHODS=password,google`
(and so on) with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Pass the secret by name, never on the command line.
Who may join (invitations, `SIGN_UP_DOMAINS`, `OPEN_SIGN_UP`) and every provider's steps are in
[Signing in with Google and others](customizing/sign-in.md).

## Behind a reverse proxy

Put an https reverse proxy (Caddy, nginx, Traefik, a load balancer) in front of the container, and publish the port to
the proxy only: `-p 127.0.0.1:8080:8080` when the proxy runs on the same host.

- **`PUBLIC_BASE_URL`** is the https address people open. Links in the app and the set-password links use it.
- **Secure cookies.** When `PUBLIC_BASE_URL` starts with `https://`, the session cookies are `Secure`: the browser sends
  them only over https.
- **`TRUST_PROXY`** is the address the proxy's connections come from, as the container sees it: comma-separated
  addresses or CIDR ranges. With a proxy on the same host that reaches the published port, that is usually the Docker
  network's gateway (`docker network inspect bridge`, `Gateway`); with a proxy in a container on a user-defined network,
  that network's subnet. Without it, every user shares the proxy's sign-in rate limit, and a saved respondent address
  is the proxy's.
- The proxy forwards every path, sets `X-Forwarded-For`, passes the app's headers through, and
  allows bodies of at least `LIMIT_MAX_DOCUMENT_BYTES` (30 MB) and requests of 5 minutes.

A Caddyfile that does all of this:

```text
surveys.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

## PostgreSQL

Set `STORAGE_PROVIDER=postgres` and `DATABASE_URL=postgres://<user>:<password>@<host>:5432/<database>`. The database
must exist; the server creates its tables. Keep `/data` mounted: it still holds the session secret, and the uploaded
files unless they are in S3. [`compose.postgres.yml`](#the-compose-examples) runs PostgreSQL next to the app.

## S3

Set `FILE_STORE=s3`, `S3_BUCKET`, `S3_REGION`, and `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (or leave both unset to
use the server's IAM role). For an S3-compatible server, also `S3_ENDPOINT` (https) and, for most of them,
`S3_FORCE_PATH_STYLE=true`. The app never creates the bucket: `surveyjs-studio s3-bucket create <name>` does.
`S3_ALLOW_HTTP=true` allows a plain-http `S3_ENDPOINT`; use it only on a private network, as the Compose example does
(the log warns at every start).

## Backups

What to back up depends on where the data lives:

| Data                    | Back it up with                                                                   |
| ----------------------- | --------------------------------------------------------------------------------- |
| SQLite and local files  | `surveyjs-studio backup` (below); the server may keep running                     |
| PostgreSQL              | `pg_dump` (below), or your database service's own backups                         |
| Local files, PostgreSQL | a copy of `/data/files`: `docker cp surveyjs-studio:/data/files ./files-backup`   |
| Files in S3             | bucket versioning (and a lifecycle rule for old versions), or your provider's own |

### SQLite and local files

**`surveyjs-studio backup`** copies the database (an online copy) and the files into a new folder,
`surveyjs-studio-YYYYMMDD-HHMMSSZ`, with a `backup.json` that describes it. A backup that did not finish never looks
complete. By default it goes to `/data/backups`, which is on the same volume: copy it off.

```sh
docker exec surveyjs-studio surveyjs-studio backup
# Backed up to /data/backups/surveyjs-studio-20261030-120000Z
docker cp surveyjs-studio:/data/backups/surveyjs-studio-20261030-120000Z ./
```

Or mount a backups volume or folder at `/backups` (a host folder must be writable by uid 1000) and run
`surveyjs-studio backup --to /backups`.

In Git Bash on Windows, run `export MSYS_NO_PATHCONV=1` first: otherwise `/backups` and `/data` in these commands become
Windows paths (`C:/Program Files/Git/backups`).

**`surveyjs-studio restore <folder>`** puts a backup back. Stop the server first: while the database is open, restore
refuses (`the database is in use: stop the container first`) and changes nothing. On a volume that already holds data,
add `--replace`: the current database and files are moved to a `replaced-<timestamp>` folder in `/data`, never deleted.

```sh
docker stop surveyjs-studio
docker run --rm -v surveyjs-studio:/data -v "$(pwd):/backups" <image>   surveyjs-studio restore /backups/surveyjs-studio-20261030-120000Z --replace
docker start surveyjs-studio
```

A backup of an older version is migrated when the server starts. The session secret is not in a backup: restored to a
new volume, the server creates a new one and everyone signs in again.

### PostgreSQL

`pg_dump` writes the database to one file. In the PostgreSQL Compose example:

```sh
docker compose -f compose.postgres.yml exec -T postgres pg_dump -U surveyjs -Fc surveyjs_studio > surveyjs-studio.dump
```

`pg_restore --clean -d <database> surveyjs-studio.dump` puts it back, with the app stopped. `surveyjs-studio backup`
covers SQLite only.

## Upgrades

1. Back up (above).
2. Pull the new image: `docker pull <image>` (or a version tag such as `v1.2`).
3. Stop and remove the container, then run it again with the same command, volume and settings.

The server applies the database migrations at start-up, under a lock, and logs them. There is no downgrade: an older
image refuses a database that a newer version migrated. To go back, restore the backup you made before the upgrade with
the older image.

## The Compose examples

[`deploy/compose/`](../deploy/compose/) has two examples. Copy `.env.example` to `.env` next to them and replace every
placeholder (`PUBLIC_BASE_URL`, the first administrator, and for PostgreSQL its password and the S3 keys).

| File                   | What it runs                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `compose.sqlite.yml`   | The app with SQLite and local files on one volume                                                       |
| `compose.postgres.yml` | The app, PostgreSQL and RustFS (an S3-compatible server); a one-off `bucket` service creates the bucket |

```sh
cd deploy/compose
cp .env.example .env    # then edit .env
docker compose -f compose.sqlite.yml up -d
```

Neither PostgreSQL nor RustFS is published on the host. `SURVEYJS_STUDIO_IMAGE` in `.env` picks another image (such as
`surveyjs-studio:self-hosted`), and `SURVEYJS_STUDIO_PORT` another host port.

The default image, `ghcr.io/surveyjs/surveyjs-studio-selfhosted-test:latest`, does not exist until the first release that
is not a pre-release. Until then set `SURVEYJS_STUDIO_IMAGE`, for example to a `v0.7.0-rc.N` tag of that package.

Change the `.env.example` administrator password before the first start: whoever signs in first with it gets the
administrator's session.

The two examples have their own Compose project names (`surveyjs-studio` and `surveyjs-studio-postgres`), so `down -v`
on one never deletes the other's volumes, and starting one does not replace the other's app.

## Outbound calls

None. The fonts, styles and scripts are in the image, and the server calls no other site. A later version adds sign-in
with Google, GitHub, Facebook and surveyjs.io: those are called only when you configure them.
