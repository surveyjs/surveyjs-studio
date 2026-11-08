# 25. File storage for the SQL providers

Date: 2026-10-29

## Status

Accepted.

## Context

The SQL providers need a `FileStore` (editor assets and respondent files, [ADR 0013](0013-editor-uploads-and-files.md)).
The spec (spec-self-hosted.md › File storage) asks for `FILE_STORE=local|s3`: files on the data volume, or in any
S3-compatible store (AWS S3, MinIO, Cloudflare R2, Backblaze B2), with the Phase 1 rules unchanged.

The `FileStore` interface asks more than "store bytes under a name":

- `usage(survey, kind)`: the sum of sizes of one survey's files of one kind (the quota);
- `deleteSurveyFiles(survey, kind?)`: every file of a survey, or of one kind;
- `copySurveyAssets(from, to)`: the assets of one survey, copied under new ids;
- each file's name, type, size and creation time.

An S3 listing gives keys and sizes but no user metadata, so answering by kind needs a HEAD per object; a folder
needs a sidecar file per upload. The SQL providers already have a database next to the files.

The plan named MinIO as the local S3-compatible server for development and tests. MinIO's images can no longer be
pulled (Docker Hub denies access to `minio/minio`, and `quay.io/minio/minio` has no manifest).

## Decision

**Metadata in the database, bytes in a byte store.** A `files` table (migration 0003,
[data model](../architecture/data-model.md)) holds each file's id, survey, kind, name, type, size and time. The
bytes are in a `ByteStore` (`server/src/bytes/`) under the key `{survey id}/{file id}`:

| `FILE_STORE`      | Byte store                               | Settings                                                                                                   |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `local` (default) | A folder: `{FILES_PATH}/{survey}/{file}` | `FILES_PATH`, default `/data/files` (the image's data volume)                                              |
| `s3`              | A bucket, through the AWS SDK v3 client  | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

`FILE_STORE` applies to the SQL providers only; `memory` and `azure-legacy` keep their own file stores.

- **Order of writes.** A new file's row is written first, so a second file with its id is refused before any byte is
  written; when the bytes cannot be stored the row is removed again. Once the bytes are stored the row is read again:
  when a delete took it meanwhile (the survey, its results or the account went), the bytes are deleted too and the
  upload is refused, so an erased respondent's file cannot outlive its row.
- **Order of deletes.** The bytes go first, then the rows. When the bytes cannot be deleted (the bucket is
  unreachable) the rows stay and the caller's retry finds them; a row whose bytes are gone reads as no file. Only a
  crash between a stored upload and its second read can leave bytes that no row names.
- **Local writes are atomic:** a temporary file in the same folder, then a rename.
- **Keys are checked** in every byte store (a lower-case GUID, `/`, 64 hex digits), so no key can name a path
  outside the folder.
- **S3 compatibility.** The client computes and checks the newer CRC checksums only where an operation requires
  them (`requestChecksumCalculation` and `responseChecksumValidation` `WHEN_REQUIRED`): several S3-compatible services
  refuse the headers newer SDK versions add by default. `S3_FORCE_PATH_STYLE=true` serves services without
  virtual-host buckets. Calls give up after 3 s without a connection or 30 s without data, and readiness waits at most
  3 s, like the database check. `S3_ENDPOINT` is https unless it is on this machine; self-hosted Step 7 added the opt-in `S3_ALLOW_HTTP=true` for an S3 server on a private network, such as the Compose example (a start-up warning says so). Without keys the SDK's default
  credential chain is used (IAM roles, environment, profile).
- **The app never creates or deletes a bucket.** Readiness (`files`) reports a missing or unreachable one
  (`HeadBucket`, with the error's name or HTTP status, never its message).
- **RustFS replaces MinIO** for local development and tests (`docker/compose.s3.yaml`, `rustfs/rustfs:1.0.1`):
  Apache-2.0, built as a MinIO drop-in, one container with its keys from environment variables. `pnpm s3:up` starts
  it and creates the development bucket; `pnpm s3:bucket create|remove <name>` makes and removes buckets for tests.

## Consequences

- Quotas, per-survey deletes and asset copies are one SQL query each, the same on local disk and S3.
- Backing up a SQL installation means the database **and** the files: the folder, or the bucket (versioning or a
  copy). Operations and the image step document both.
- The hosted migration copies legacy files into the byte store and fills `files` (and `legacy_files`), so the
  hosted service can use S3-compatible object storage with the same code.
- Any S3-compatible service the AWS SDK reaches works. Only RustFS and the SDK's behaviour are tested; R2, B2 and
  AWS S3 are expected to work with the settings above, and the operations guide names the settings each needs.
