# 2. Node.js 24 LTS

Date: 2026-10-14

## Status

Accepted

## Context

`spec.md` requires one Node.js LTS major, pinned in `engines`, `.nvmrc` and the Docker base image.
The server runs TypeScript directly with `tsx`, so the runtime is also the development runtime.
We needed to pick the major when the repository was created.

## Decision

Use Node.js **24** (the LTS line). `.nvmrc` is `24.21.0` and `engines.node` is `>=24.21.0 <25`.
`.npmrc` sets `engine-strict=true`. CI reads `.nvmrc`. Renovate may not propose Node.js 25 or higher.
pnpm is pinned by the `packageManager` field (12.11.2).

## Consequences

- Install fails on another major, so everyone runs the same runtime as CI.
- Moving to the next LTS is a major upgrade: its own pull request, changing `.nvmrc`,
  `engines.node`, the Renovate rule and the Docker image together, with an ADR that records
  what changed and how it was verified (full test run, e2e, conformance suite).
- On machines where Node 24 is not the default, a version manager is needed (`nvm use`).
