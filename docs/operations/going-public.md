# Going public: the secrets scan and the review

The repository `surveyjs/surveyjs-studio` is private until the product owner switches it to public. The history becomes
public with it: every commit, every branch and every tag, and every past version of every file. This page records what
was checked before the switch, what the scan found, and what to turn on in the GitHub settings afterwards.

Date of the check: 2026-11-06. Nothing was rewritten and nothing was pushed for it.

## The scan

Gitleaks reads the git history, not only the current files. The CI job `secrets` repeats it on every push and pull
request, over the history of the checked-out commit, so a secret that is committed later fails the build.

| Item         | Value                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Tool         | Gitleaks `v8.24.0`, the image `zricethezav/gitleaks:v8.24.0` pinned by digest, default rules   |
| Command      | `pnpm scan:secrets --all-refs --report <file>`                                                 |
| Refs scanned | Every local branch, every remote-tracking branch and every tag (`--log-opts=--all`)            |
| Commits      | 426 with `--all-refs`, 412 for the checked-out history (HEAD), after `git fetch --all --prune` |
| Result       | 27 findings, all synthetic. After the allowlist: `no leaks found`                              |

`pnpm scan:secrets` mounts the repository into the container read-only and redacts the matches. Without `--all-refs`
it passes `--log-opts=HEAD` and scans the history reachable from the checked-out commit, which is what CI does.
(Gitleaks with no `--log-opts` would scan every ref in the clone, so both modes name theirs.) Run the wide scan again
any time:

```bash
pnpm scan:secrets --all-refs
```

The scan also runs on the staged files before each commit, through the `.githooks/pre-commit` hook that `pnpm install`
enables. Because `.gitleaksignore` is bound to commit ids, the synthetic values that recur in the tree are also
allowlisted by value in [`.gitleaks.toml`](../../.gitleaks.toml), which every scan mode reads.

### The findings

Every finding is rule `generic-api-key`. Each one was opened at its commit and line, and each value is a public
example, a documented placeholder or a test constant. The fingerprints are in
[`.gitleaksignore`](../../.gitleaksignore), grouped with the same reasons.

| File (all commits)                                                                                                                                                  | Count | Why it is synthetic                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `docker/azurite.env`, `docker/prod-like.env`                                                                                                                        | 4     | The Azurite emulator's well-known `devstoreaccount1` key, which Microsoft publishes |
| `server/demo.env`, `server/demo-azurite.env`, `conformance-tests/src/global-setup.ts`, `conformance-tests/src/reference-settings.ts`, `docs/customizing/porting.md` | 5     | Demo and conformance webhook secrets. The `whsec_` values are base64 of plain words |
| `server/src/read-only.test.ts`, `accounts/handlers.test.ts`, `accounts/webhook-secret.test.ts`, `cli/send-account-deleted.test.ts`, `config.test.ts`                | 5     | The Svix documentation's example secret, used as a test constant                    |
| `server/src/auth/session.test.ts`, `auth/seal.test.ts`, `config.test.ts`, `config-branding.test.ts`                                                                 | 5     | The placeholder session secret `0123456789abcdef0123456789abcdef`                   |
| `server/src/smoke/smoke-legacy.azurite.test.ts`, `providers/azure-legacy/provider.test.ts`                                                                          | 2     | Fixture keys for the local emulator and a provider that is never reached            |
| `docs/api/admin-users.md`, `contract/openapi.yaml`, `contract/generated/openapi.d.ts`, `web/src/adminRoutes.test.tsx`                                               | 4     | The documented example set-password token `7cJ2rQ0wUu8xXnYk3fVb1A`                  |
| `docs/api/public-endpoints.md`                                                                                                                                      | 1     | An example `Idempotency-Key` UUID                                                   |
| `server/src/passwords/common-passwords.ts`                                                                                                                          | 1     | `masterpassword`, an entry in the list of common passwords that the server refuses  |

The fingerprints in `.gitleaksignore` are bound to commit ids. The step branches must be merged with merge commits,
never rebased or squashed, or the ids change and the findings come back. Any history rewrite (a mailmap rewrite, for
example) also needs a re-baseline of the file.

A real secret is never added to `.gitleaksignore`. If the scan finds one, rotate it first. Removing it from the
history is a rewrite, and that is the product owner's decision.

## The review

### Branch tips and production identifiers

Every branch tip and tag was searched for Azure SQL and storage host names (`*.database.windows.net`,
`*.core.windows.net`), public IPv4 addresses, `@devsoftbaltic` and `@surveyjs` addresses, and Hetzner host names.

Result: nothing real. The hits are `example` and placeholder names in tests (`prodacct`, `site.database.windows.net`),
private and documentation address ranges, the placeholder `1.2.3.4`, a container image version, and the Hetzner setup
guides, which name the provider and not a server. The only other address is `impallari@gmail.com`, in the licence text
of the Raleway font.

A search of all added lines in the whole history for addresses outside `example.*` found only that one and a package
author's address in a licence text.

### Screenshots

All 54 PNGs in `e2e/visual/baselines/` and the 9 PNGs in `e2e/visual-self-hosted/baselines/` were opened, and so was
the one fixture image. The `states.json` next to the first set is not an image.

- The 18 screens of Chromium were each opened. Firefox and WebKit render the same states from the same seed, so three
  of them were opened to check (the survey list, the table and the expanded project). They are identical in content.
- Names that appear: "Visual User" and "Visual project", "Adam Admin", "Olivia Owner", "Ivy Instance" and the other
  fixture people. Addresses that appear are `*@example.com`. Dates are `1/1/2026` and similar fixture dates.
- Surveys that appear: "Customer feedback", "Event registration", "Product poll", "Old poll", "Team retro", "API
  created" and "Draft idea". All are seed data.
- The fixture image is a single purple pixel.

The review also covered the 19 superseded baseline versions in history, which show seed data only.

Result: no real person's name, address or survey.

### The planning documents

The user decided on 2026-11-06 that `idea.md`, `spec*.md` and `plan*.md` stay in the repository and go public. The
check covered their current text and every past version (64 commits that touch them), together with
`docs/operations.md`, `docs/architecture/legacy-data-layout.md` and `docs/demo/step-14.md`.

| Looked for                                | Result                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Credentials, connection strings, tokens   | None. Only `<placeholders>`, `…` and names of variables                                                                   |
| Real host names                           | Only the public site names: `surveyjs.io`, `studio.surveyjs.io`, `api.surveyjs.io`, `auth.surveyjs.io` and the demo hosts |
| IP addresses                              | None, apart from `127.0.0.1`, `0.0.0.0` and `203.0.113.0`                                                                 |
| Names or addresses of customers and users | None. Addresses are `owner@example.com` and the like                                                                      |
| Prices, revenue, contract terms           | None                                                                                                                      |
| Anything told in confidence               | None                                                                                                                      |
| Personal data                             | None                                                                                                                      |

Changes made to the current text: none were needed.

### Commit author emails

Every commit's author address becomes public. `git log --all --format='%ae' | sort -u`:

There are three distinct author addresses: the company domain, GitHub noreply addresses, and one personal address.
The noreply addresses are GitHub's private ones. The personal address is a contributor's, and it is the author email
on 12 commits.

### For the product owner to decide

None of these is a secret, so none blocks the switch. Each is in past versions too, so changing it needs a history
rewrite.

1. **A contributor's personal address** is the author email on 12 commits. Ask the author whether it may be public.
   If not, the history must be rewritten with a mailmap (see the note on `.gitleaksignore` below).
2. **Production-scale figures.** Production usage counts appear in `docs/demo/step-14.md` and in past versions of
   `docs/operations.md` and the plans. They are usage numbers of the live service.
3. **References to the site's private source code and its schema.** The legacy layout page and the plans name the
   site's private source paths, secret names and schema names. The page exists to describe that layout, and the user
   has chosen to publish it. Confirm that the site team agrees.
4. **The local ref `refs/original/refs/heads/self-hosted`.** It is a backup that an earlier history rewrite left in this
   clone. It was scanned with the rest and is clean. Delete it (`git update-ref -d` on that ref) before any
   `git push --mirror`, so that it is not published.

## After the switch: the GitHub settings

Do these in **Settings** of the repository as soon as it is public.

| Where                                           | What to turn on                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code security → Secret scanning                 | Turn on **Secret scanning** and **Push protection**                                                                                                       |
| Code security → Private vulnerability reporting | Turn on, so reporters can write to you privately                                                                                                          |
| Code security → Dependabot                      | Turn on **Dependabot alerts**                                                                                                                             |
| Actions → General → Fork pull request workflows | Choose **Require approval for all outside collaborators**                                                                                                 |
| Branches → master branch protection             | Require the `ci` status check and block force pushes                                                                                                      |
| Packages (the organisation's page)              | Check that `surveyjs-studio` and `surveyjs-studio-selfhosted-test` are still private. Making a repository public does not publish its packages, but check |

The `secrets` job stays in CI after the switch. Keep [`.gitleaksignore`](../../.gitleaksignore) short: every entry
needs a reason in the comment above it.
