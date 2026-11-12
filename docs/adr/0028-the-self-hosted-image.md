# 28. The self-hosted image

Date: 2026-10-30. Amended 2026-11-12: the package names (D1, D2 and [Consequences](#consequences)).

## Status

Accepted.

## Context

Self-hosted Step 7 builds the free Docker image of mode 2b (spec-self-hosted.md › Docker image; S1, S5, S8–S11, S45):
one command to run, a volume for the data, safe upgrades, backups, no outbound calls, images for amd64 and arm64, and a
release pipeline with an SBOM and a scan. The Step 14 image ([ADR 0021](0021-production-image-and-web-serving.md))
already runs studio.surveyjs.io and must not change. Two inputs are missing: push access to Docker Hub and the licence
key the image will ship with (spec open question 1).

## Decision

**D1. A separate build target.** `docker build --target self-hosted` is the 2b image. It shares the build stages with
the hosted image; only its last stage differs: the 2b defaults (`APP_SHELL=self-hosted`, `STORAGE_PROVIDER=sqlite`,
`FILE_STORE=local`, `AUTH_METHODS=password`, `USER_DIRECTORY=local`), port 8080, `VOLUME /data`, the user `node`
(uid 1000), and the `surveyjs-studio` command (`backup`, `restore`, `migrate`, `status`, `seed`, `s3-bucket`, and later `rebase-urls`). The
hosted `runtime` stage stays last, so `docker build .` gives the same image as before: settings, port 3000 and the
`<sha>` tags (in `ghcr.io/surveyjs/surveyjs-studio-hosted` since 2026-11-12; `surveyjs-studio` before).

**D2. A private test package.** Until Docker Hub access and the shipped key exist, a `v*` tag pushes to
`ghcr.io/surveyjs/surveyjs-studio-selfhosted-test` only, with `GITHUB_TOKEN`. One workflow variable, `RELEASE_IMAGE`
in `release.yml`, names the target. The release pushes by digest and tags only after the arm64 smoke run and the scan
pass, so a failed release moves no tag. **Amended 2026-11-12:** the target is `ghcr.io/surveyjs/surveyjs-studio`,
still private, and the hosted image moved to `ghcr.io/surveyjs/surveyjs-studio-hosted`. The product's image has the
product's name, the same on ghcr.io and later on Docker Hub; the internal deployment carries the suffix.

**D3. The session secret on the volume.** `SESSION_SECRET_FILE` (the image sets `/data/session-secret`): when
`SESSION_SECRET` is unset, the server reads the file, or creates it once with a random secret (mode `0600`, written
atomically). `SESSION_SECRET` wins when both are set. While `SESSION_SECRET` is unset (the image default), a `/data` the
container cannot write stops the start with one line that names the path and uid 1000; with it set, nothing reads the
file, and the first write to `/data` fails with its own error.

**D4. `PUBLIC_BASE_URL`** defaults to `http://localhost:8080` in the image only; the server still requires it in
production. While it names `localhost` under `NODE_ENV=production`, the start-up log warns, before the setup link, that sign-in
and set-password links, the sign-out redirect and the stored addresses of uploaded files use it. Files uploaded under a
wrong address stay broken after it is fixed, so the warning says to set it before anyone uploads.

**D5. The image's licence key** is `SURVEYJS_IMAGE_LICENSE_KEY`, set from a build argument (the CI secret of the same
name; empty when absent). The key the app uses is `SURVEYJS_LICENSE_KEY`, else `SURVEYJS_IMAGE_LICENSE_KEY`.
`BRANDING=off` requires a `SURVEYJS_LICENSE_KEY` that is set and differs from the image's key
([ADR 0027](0027-branding-and-the-licence-key.md)). This is not a security boundary (anyone can override an environment
variable); the libraries' check is. The shipped key is readable by anyone who pulls the image (it is in `ENV`, and
the provenance records the build argument).

**Release attestations.** The release's `--sbom=true` and `--provenance=mode=max` attestations are pushed with the image
as buildx builds it. The plan expected `id-token: write` and `attestations: write` on the `publish` job for signed
attestations; the job has neither, so the attestations are not signed.

**D6. The proxy setting stays `TRUST_PROXY`** (built in Phase 1; the spec names it). The plan's `TRUSTED_PROXIES` is a
typo; nothing is renamed.

**D7. The S3 server of `compose.postgres.yml` is RustFS**, as in `docker/compose.s3.yaml`: MinIO's images are no longer
published. The plan's "MinIO" means "an S3-compatible server". A one-off `bucket` service of the same image creates the
bucket (`surveyjs-studio s3-bucket create`). The example talks to RustFS over plain http on the Compose network, so it
sets the new opt-in `S3_ALLOW_HTTP=true` ([ADR 0025](0025-file-storage-for-the-sql-providers.md)); the server warns at
start-up while it is on with an endpoint that is not on this machine.

**D8. One build per architecture, without emulating the build.** The build stage runs on `$BUILDPLATFORM`; only the
`runtime` and `self-hosted` stages are per platform. As first written, D8 shipped the build machine's optional binaries:
an arm64 image built on x86 held esbuild's `linux-x64` package and could not start. **Amended:** the server's
`pnpm deploy` installs the target's binaries (`--os=linux --cpu=<x64|arm64> --libc=glibc`, from `TARGETARCH`), and the
build fails unless the deploy output holds `@esbuild/linux-<cpu>` and no other `@esbuild/*` package, and no `.node`
file. The release workflow starts the pushed arm64 image under QEMU and requires `/healthz` within 90 s.

**Backups.** `surveyjs-studio backup` copies the SQLite database (online, `node:sqlite`'s backup) and the local files
into `surveyjs-studio-<UTC time>/` with a `backup.json`; the folder is written under a `.partial-` name and renamed when
complete. `restore` refuses a folder without `backup.json`, and refuses while the database is open ("stop the container
first"). The default target is `/data/backups`. The image also has an empty `/backups` folder owned by `node` (not a
`VOLUME`): a named volume mounted there takes that owner, so `backup --to /backups` works without a `chown`.

**No outbound calls.** The Form Library's brand block loads its logo from surveyjs.io. The self-hosted shell's run page
shows the same block with the logo served by the app, under the shell's own "Powered by SurveyJS" footer; `BRANDING=off`
hides both. The `surveyjs-site` shell keeps the library's block. The e2e suites run on the image with Chromium's
outbound network blocked.

## Consequences

- Every push runs the image checks and the SQLite, password and self-hosted e2e suites on the self-hosted image
  (`self-hosted-image.yml`, next to `ci`). A release runs the same, plus the upgrade from the previous release.
- The hosted image and its publish job are unchanged.
- **When Docker Hub access and the shipped licence key arrive:**
  - `RELEASE_IMAGE` changes to `surveyjs/surveyjs-studio` (Docker Hub, with a login step and its token as a secret),
    and a second push or `docker buildx imagetools create` mirrors the tags to `ghcr.io/surveyjs/surveyjs-studio`.
  - **Done 2026-11-12:** that GHCR name was the hosted image's package, so one package would have held two different
    images. The hosted image moved to `surveyjs-studio-hosted` (`ci.yml`, `deploy.yml`, `setup.sh`'s default and
    the server's `IMAGE`), releases went to `ghcr.io/surveyjs/surveyjs-studio` at once, and the Compose examples'
    default image became `ghcr.io/surveyjs/surveyjs-studio:latest`. The hosted commit-id tags left in
    `surveyjs-studio` are deleted before that package is made public, and `surveyjs-studio-selfhosted-test` is
    deleted.
  - The default image of the Compose examples and the docs' image name change to `surveyjs/surveyjs-studio`.
  - The `SURVEYJS_IMAGE_LICENSE_KEY` secret is set; nothing in the code changes.
- A downgrade is refused: an older image does not start on a database a newer version migrated. Going back means
  restoring the backup made before the upgrade.
