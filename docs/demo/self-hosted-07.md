# Demo: self-hosted Step 7, the Docker image

This page lets you check self-hosted Step 7 without reading code. It takes about thirty minutes, most of it image
builds. Commands are for Git Bash (or any POSIX shell), from the repository root.

What Step 7 delivers: **the free self-hosted image (mode 2b).** One `docker run` gives a working service with SQLite on
the volume `/data`, password sign-in and the self-hosted shell, on port 8080, as a non-root user. A newer image upgrades
the same volume. `surveyjs-studio backup` and `restore` save and bring back the data. Compose examples run it with
SQLite, or with PostgreSQL and an S3-compatible server. The pages make no calls to other sites. Details:
[Self-hosting](../self-hosting.md) and [ADR 0028](../adr/0028-the-self-hosted-image.md).

## Before you start

You need Docker with Compose, and port 8080 free. Build the image (a few minutes the first time):

```sh
pnpm image:build:self-hosted
```

It is tagged `surveyjs-studio:self-hosted`. The demo uses the volumes `sjs-demo` and `sjs-demo-backups` and the
container `sjs-demo`; if they exist from an earlier try, run the [Clean up](#clean-up) commands first.

The first admin's password is a local demo constant. It goes to Docker by name, never on the command line:

```sh
export ADMIN_PASSWORD='a long local password'
```

## 1. One command, then the whole flow (checklist 1)

1. Start the image on a new volume, with a first admin:

   ```sh
   docker run -d --name sjs-demo -p 8080:8080 -v sjs-demo:/data \
     -e ADMIN_EMAIL=admin@example.test -e ADMIN_PASSWORD surveyjs-studio:self-hosted
   docker logs -f sjs-demo   # Ctrl+C stops following, not the container
   ```

   - **Check:** the log says `created the first admin from ADMIN_EMAIL; the password must be changed at first sign-in`,
     and warns `PUBLIC_BASE_URL is http://localhost:8080: sign-in and set-password links point there; …`.
   - **Check:** `docker exec sjs-demo id -u` prints `1000`.

2. Open <http://localhost:8080>. **Check:** the **Sign in** page, with Email and Password.
3. Sign in as `admin@example.test` with `a long local password`. **Check:** the **Change your password** page opens.
   Enter the current password, then `the admin's own new password` twice, and click **Change password**. **Check:** My
   Surveys opens, inside the self-hosted header and footer (**Powered by SurveyJS**).
4. Click **Create a Survey**. In the editor, add a question (drag a **Single-Line Input** onto the page) and wait for
   **All changes saved**. Go back and rename the survey to `Docker demo` (click its name).
5. Open its "…" menu, choose **Publish**, then **Run**. Answer the question and click **Complete**.
6. Back in My Surveys, open the "…" menu and choose **View Results**. **Check:** one response, with your answer.

## 2. A newer build on the same volume (checklist 2)

1. Build a newer image (only its version label differs, so it is quick) and check its version:

   ```sh
   docker build --target self-hosted --build-arg VERSION=demo-2 -t surveyjs-studio:self-hosted .
   docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' surveyjs-studio:self-hosted
   ```

   **Check:** it prints `demo-2`.

2. Replace the container: same volume, no admin settings this time.

   ```sh
   docker stop sjs-demo && docker rm sjs-demo
   docker run -d --name sjs-demo -p 8080:8080 -v sjs-demo:/data surveyjs-studio:self-hosted
   ```

3. Open <http://localhost:8080> and sign in with `the admin's own new password`.
   - **Check:** no forced password change; `Docker demo` is in the list, and **View Results** shows the response.
   - **Check:** `docker logs sjs-demo` shows no setup link (the instance has an admin).

## 3. Compose with PostgreSQL and S3 (checklist 3)

1. Stop the SQLite container (it keeps its data for part 4): `docker stop sjs-demo`.
2. Make the Compose settings. `deploy/compose/.env` is gitignored:

   ```sh
   cd deploy/compose
   cp .env.example .env
   ```

   Edit `.env`: `PUBLIC_BASE_URL=http://localhost:8080`, `ADMIN_EMAIL=admin@example.test`,
   `ADMIN_PASSWORD=a long local password`, and add `SURVEYJS_STUDIO_IMAGE=surveyjs-studio:self-hosted`. Leave the
   PostgreSQL and S3 placeholders: they are fine on this machine.

3. Start it:

   ```sh
   docker compose -f compose.postgres.yml up -d --wait
   docker compose -f compose.postgres.yml ps -a
   ```

   - **Check:** `postgres`, `s3` and `app` are running and healthy; `bucket` exited with code 0.
   - **Check:** `docker compose -f compose.postgres.yml logs app` shows the `starting` line with
     `"storageProvider":"postgres"`, and the warning
     `S3_ENDPOINT is plain http (S3_ALLOW_HTTP=true): keep the S3 server on a private network`.

4. Repeat part 1, steps 2–6, at <http://localhost:8080>. **Check:** the same flow works; the survey is on PostgreSQL
   and its files in RustFS.
5. Stop it, keeping its data until the clean-up, and go back to the repository root:

   ```sh
   docker compose -f compose.postgres.yml down
   cd ../..
   ```

## 4. Back up, delete the volume, restore (checklist 4)

1. Start the SQLite container again: `docker start sjs-demo`. Back it up to a volume of its own, while it runs:

   ```sh
   docker run --rm -v sjs-demo:/data -v sjs-demo-backups:/backups surveyjs-studio:self-hosted \
     surveyjs-studio backup --to /backups
   ```

   **Check:** it prints `Backed up to /backups/surveyjs-studio-<date>-<time>Z`, the migration and the files. Note the
   folder name.

2. Try to restore while the server runs:

   ```sh
   docker run --rm -v sjs-demo:/data -v sjs-demo-backups:/backups surveyjs-studio:self-hosted \
     surveyjs-studio restore /backups/surveyjs-studio-<date>-<time>Z --replace
   ```

   **Check:** it refuses with `the database is in use: stop the container first`, and the app still works.

3. Delete the container and its volume:

   ```sh
   docker rm -f sjs-demo
   docker volume rm sjs-demo
   ```

4. Restore into a new, empty volume (no `--replace` needed), then start the app on it:

   ```sh
   docker run --rm -v sjs-demo:/data -v sjs-demo-backups:/backups surveyjs-studio:self-hosted \
     surveyjs-studio restore /backups/surveyjs-studio-<date>-<time>Z
   docker run -d --name sjs-demo -p 8080:8080 -v sjs-demo:/data surveyjs-studio:self-hosted
   ```

5. Open <http://localhost:8080>. **Check:** the **Sign in** page (the session secret is new, so the old session ended).
   Sign in with `the admin's own new password`. **Check:** `Docker demo` and its response are back.

## Clean up

```sh
docker rm -f sjs-demo
docker volume rm sjs-demo sjs-demo-backups
(cd deploy/compose && docker compose -f compose.postgres.yml down -v && rm .env)
unset ADMIN_PASSWORD
```

## What the automated tests cover

- `pnpm image:checks --image surveyjs-studio:self-hosted`: non-root, the setup link on an empty volume, the user flow
  with outbound network blocked, backup and restore, no settings file in the image, and both Compose examples;
  `--previous <tag>` adds the upgrade from an older image.
- `pnpm test:unit`: the session secret file, the localhost warning, the image's licence key, `backup` and `restore`,
  and the release tags.
- In CI (Linux): the image checks and the SQLite, password and self-hosted e2e suites on the self-hosted image, with
  Chromium's outbound network blocked. A `v*` tag also runs the upgrade check, pushes amd64 and arm64, starts the arm64
  image under QEMU and scans the amd64 image.
