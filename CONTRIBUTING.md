# Contributing

Thank you for helping with SurveyJS Studio. This page lists what a pull request needs. It points to the other docs
instead of repeating them.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. To report a security problem, follow
[SECURITY.md](SECURITY.md). Do not open an issue for it.

## Set up

[Development](docs/development.md) covers the setup, the demo modes and every script. [Testing](docs/testing.md)
describes the test suites.

## The pre-commit secrets scan

`pnpm install` points git at the tracked hooks in `.githooks` (`core.hooksPath`), so every `git commit` scans the staged
files for secrets with gitleaks before it goes through. A blocked commit shows gitleaks' output: the rule, the file and
the line, with the value redacted.

The scan needs `node`, the installed `node_modules`, and either a `gitleaks` binary on your PATH or Docker. When
something is missing, the commit is not blocked. The hook prints one warning line and lets it through, and CI scans the
history anyway:

- no `node` on PATH or no `node_modules` (a fresh worktree, `git clean -xdf`, a GUI client): `pre-commit: secrets scan
skipped (run pnpm install; node and node_modules are needed). CI will scan.`;
- neither gitleaks nor Docker, a Docker daemon that does not answer `docker info` within 5 seconds, or `docker run`
  itself failing (exit 125, 126 or 127): `secrets scan skipped: ...; CI will scan`;
- a linked `git worktree` when only Docker is available (its `.git` points outside the mounted directory): install
  gitleaks, or commit from the main checkout.

Gitleaks exiting with 1 always blocks, because a finding and a gitleaks error look the same. Bypass the hook with
`git commit --no-verify` only for a verified false positive, or after you have confirmed that the block is a scanner
error and the commit is clean. If the finding is a real secret, remove it and rotate it.

Allowlisting: the fingerprints in `.gitleaksignore` name a commit, so they never match a staged diff. A synthetic value
that recurs in the tree goes into the `[allowlist]` of [`.gitleaks.toml`](.gitleaks.toml) as a `regexes` entry; a real
value never does. The hook is not installed in CI, where there is no git, or when `core.hooksPath` already has another
value (the installer says so). Run `pnpm scan:secrets --staged` by hand to scan the staged files at any time.

## Before you open a pull request

Run these from the repo root:

| Check                        | What it covers                                                      |
| ---------------------------- | ------------------------------------------------------------------- |
| `pnpm typecheck`             | Types in every workspace                                            |
| `pnpm lint`                  | ESLint                                                              |
| `pnpm format:check`          | Prettier                                                            |
| `pnpm test:unit`             | Unit tests                                                          |
| `pnpm test:conformance`      | The API conformance suite                                           |
| `pnpm e2e` or a variant      | The end-to-end suite your change touches, such as `pnpm e2e:sqlite` |
| `pnpm lint:contract`         | The OpenAPI contract, when you changed it                           |
| `pnpm check:docs-links`      | Links in the docs, when you changed a page                          |
| `pnpm check:example-shell`   | The example shell in the [shells guide](docs/customizing/shells.md) |
| `pnpm scan:secrets`          | A secrets scan of the full history (needs Docker)                   |
| `pnpm scan:secrets --staged` | A secrets scan of the staged files, as the pre-commit hook runs it  |

Run Prettier from the repo root, never from `web/`. From `web/` it rewrites the copied surveyjs.io SCSS. Use
`pnpm format` to fix formatting.

## The contract comes first

The API is defined in `contract/openapi.yaml`. Change the contract first, then run `pnpm lint:contract`. The server,
the web app and the conformance suite follow it. See
[Changing the contract](docs/development.md#changing-the-contract).

## Decisions

Write an [architecture decision record](docs/adr/README.md) for a decision that is hard to reverse or that others
will ask about later. Add it in the same pull request as the change.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
fix(server): refuse a project name that is only spaces
docs(customizing): add a page on shells
```

Keep each commit to one change.

## Licence

The code in this repository is MIT ([LICENSE](LICENSE)). When you contribute, you agree that your contribution is
under the same licence.
