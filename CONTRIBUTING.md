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
files for secrets with gitleaks before it goes through. A finding blocks the commit and is printed with the value
redacted. The scan needs either a `gitleaks` binary on your PATH or Docker; with neither it prints
`secrets scan skipped: neither gitleaks nor Docker is available; CI will scan` and lets the commit through, and CI scans
the history anyway.

Bypass the hook with `git commit --no-verify` only for a false positive. If the finding is a real secret, remove it and
rotate it. A value goes into `.gitleaksignore` only when it is synthetic. The hook is not installed in CI or where
there is no git; run `pnpm scan:secrets --staged` by hand to scan the staged files at any time.

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
