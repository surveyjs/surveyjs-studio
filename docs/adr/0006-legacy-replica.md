# 6. SQL Server 2022 next to Azurite for the legacy replica

Date: 2026-10-14

## Status

Accepted

## Context

Development and CI need an offline copy of the legacy stores, so that the `azure-legacy` provider
can be tested without touching a real Azure account. The legacy site uses Azure Tables, Blobs and
Files, and SQL for users, surveys, projects and memberships
([layout, section 10](../architecture/legacy-data-layout.md#10-replica-plan)).

- Azurite emulates Blob, Queue and Table. It has no SQL, so the directory and the survey records
  need a real SQL Server.
- Azure SQL Edge, the usual small SQL container, was retired in 2025.
- Azurite has no Azure Files service.

## Decision

`docker/compose.azurite.yaml` starts two containers:

- **Azurite 3.37.0** with `--skipApiVersionCheck`, so that the current Azure SDK works with it.
  Blob on 127.0.0.1:10000, Table on 127.0.0.1:10002. All three legacy storage accounts live in
  this one account; their table and container names do not collide.
- **SQL Server 2022** (`mcr.microsoft.com/mssql/server:2022-CU24-ubuntu-22.04`) on
  127.0.0.1:14333. The schema is our own DDL in `server/fixtures/legacy/sql/schema.sql`, with
  the indexes and keys of the legacy database.

Both bind to 127.0.0.1 only. `docker/azurite.env` holds local-only values; the storage key is
Microsoft's public development key. The fixture loader refuses to write to any endpoint that is
not local. `pnpm demo:azurite:up` starts the containers and loads the fixtures;
`pnpm demo:azurite:down` removes them and their volumes.

Legacy files (editor assets and respondent files) are kept in `server/fixtures/legacy/files/` as
fixtures, but they are not loaded: Azure Files is not emulated.

## Consequences

- Docker is needed for Azurite mode, the provider suite on Azurite and the Azure legacy
  conformance run. The default `pnpm test:unit` does not need it.
- The SQL Server image is large and slow to start. CI waits for the health checks.
- Reading legacy files from the replica is not tested. When file reads are built, either a stub
  behind the file store or a real Azure Files account is needed.
- Step 3 can run the end-to-end tests on Azurite once the mock OIDC server exists.
