# Demo: self-hosted Step 11, developer documentation and open-source readiness

This page lets you check self-hosted Step 11 without reading code. It takes about thirty minutes and needs Docker. The
long runs (the example shell in the browser and the conformance suite) are described, and you start them yourself.
Commands are for Git Bash (or any POSIX shell), from the repository root.

What Step 11 delivers: **mode 3 is documented, and the repository is ready to be public.** The guides are in
[`docs/customizing/`](../customizing/overview.md). The example shell in the shells guide is built and tested in CI. The
conformance suite runs against any server with `--base`. The history was scanned for secrets, the repository has its
hygiene files, and the image carries a third-party notice. Details:
[Customizing](../customizing/overview.md) and [Going public](../operations/going-public.md).

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists (Node and `pnpm install`),
Docker running, and the image `surveyjs-studio:self-hosted` for part 5 (`pnpm image:build:self-hosted` builds it).
Ports 3000 and 5173 must be free.

## 1. The example shell

```sh
pnpm check:example-shell
```

**Check:** it prints `Preparing worktree (detached HEAD <sha>)`, installs the dependencies in a scratch worktree, and
ends with `The example shell builds and passes its test.` Vitest reports `Tests  1 passed (1)`. The command takes a few
minutes. Your own working tree is untouched, and the scratch worktree is removed.

This is what CI runs: it extracts the code of [the shells guide](../customizing/shells.md) into the worktree, adds the
registry line and runs the type check and the test there.

Now see the shell on screen, the way a reader of the guide would:

1. Make a scratch branch: `git switch -c scratch/example-shell`.
2. Follow [the example](../customizing/shells.md#the-example): create the three files and the registry line the page
   shows.
3. Start the app with the shell's name:

   ```sh
   APP_SHELL=example pnpm demo
   ```

4. Open <http://localhost:5173>, sign in as **Olivia Owner**.
   - **Check:** the header says **Example Studio**, with Olivia's name, **Projects** and **Sign Out**, and the survey
     list is below it.

Stop the demo with Ctrl+C. Files you did not commit stay in the working tree when you switch branches, so clean them
first: `git restore --staged --worktree web/src/shell` and delete the new `example` folder. Then `git switch -` and
`git branch -D scratch/example-shell`.

## 2. The conformance suite against the reference image

[The porting guide](../customizing/porting.md#running-the-reference-image) runs the suite against the reference
server's production image. On Linux it is exactly the guide's commands: build `surveyjs-studio-hosted:ci`, write the settings
with `reference-env`, run the container with `--network host`, wait for `http://127.0.0.1:3000/readyz`, then:

```sh
export CONFORMANCE_WEBHOOK_SECRET='<the value in porting.md>'
pnpm test:conformance --base http://127.0.0.1:3000
```

**Check:** the suite passes, with no skipped webhook tests. On Windows and macOS `--network host` does not reach the
host, so run the plain `pnpm test:conformance` instead. It starts the same server itself and passes the same tests.
Remove the container with `docker rm -f reference`.

Two refusals are worth a minute:

```sh
pnpm test:conformance --base http://127.0.0.1:3000/api/v1
pnpm test:conformance --base
```

**Check:** the first stops with exit code 2 and says the suite adds `/api/v1` itself; the second stops with exit code 2
and a usage message. Neither starts a test.

## 3. The secrets scan and the hygiene files

```sh
pnpm scan:secrets --all-refs
```

**Check:** it ends with `<N> commits scanned.` and `no leaks found`. (`<N>` is the number of commits it read and grows
with the repository. `--all-refs` reads every local branch, remote-tracking branch and tag; without it, `pnpm scan:secrets`
reads only the history of the checked-out commit, which is what CI runs. A Docker image runs the tool, so the first run
pulls it.) The synthetic values it
skips are listed in [Going public](../operations/going-public.md#the-findings) and in `.gitleaksignore`.

List the files a visitor to the public repository sees:

```sh
ls CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .github/pull_request_template.md .github/ISSUE_TEMPLATE
```

**Check:** the first four exist, and `ISSUE_TEMPLATE` holds `bug_report.yml`, `config.yml` and `feature_request.yml`.

The issue forms only render on GitHub. See them in a scratch fork, or in the repository after the switch: **Issues › New
issue** offers **Bug report** and **Feature request**, and `config.yml` turns off blank issues and links to the security policy for
vulnerabilities. The guide for the switch itself is [Going public](../operations/going-public.md); do not
change the visibility as part of this demo.

## 4. The links in the docs

```sh
pnpm check:docs-links
```

**Check:** it prints `Docs links: 12 files checked, all links hold.` It follows every relative link and heading anchor
in the customizing guides, the contribution files and the going-public page. Break one on purpose (change a heading
name a link points to), run it again and see it name the file and the link, then undo the change.

## 5. The third-party notice

```sh
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint head surveyjs-studio:self-hosted -n 20 /app/THIRD_PARTY_NOTICES.md
```

(`MSYS_NO_PATHCONV=1` stops Git Bash on Windows from turning `/app/...` into a Windows path.)

**Check:** the output starts with `# Third-party notices`, then the sentence "SurveyJS Studio includes the components
below. Each entry gives the licence the package declares and the licence text it ships.", then the first entry,
a heading with a package name and version, then `License: ...` and the start of its licence text. The same file is
in the `surveyjs-studio-hosted:local` image.

## 6. The README

Open [README.md](../../README.md). **Check:** **Deployment modes** has one section per mode (**Hosted**, **Self-hosted
image**, **Sandbox**, **Custom development**, **Development**), each with what it is, its state and where to start.
**Documentation** lists the customizing guides, contributing and security. **Licence** mentions the notice.

## 7. The sandbox token (reading only)

Open [Operations › One-time setup](../operations.md#one-time-setup-product-owner). **Check:** the token in step 1 is
"only while the repository is private", and step 5 says that once it is public the compose `secrets` blocks are removed
and an empty token is a `401`. [ADR 0031](../adr/0031-publishing-the-sandbox.md) has the dated note.

## Clean up

Nothing stays running. If you started the reference image: `docker rm -f reference`. Delete `ref.env` if you made it.

## What the automated tests cover

- `pnpm test:unit`: the scripts of this step (the secrets scan's argument builder, the `--base` parser, the example-shell
  extractor and its cleanup, the docs-link checker and its slugger, the notice generator).
- CI: the `secrets` job, the `conformance-base` job (the suite against the image), the example-shell check, the docs-link
  check and the image build that writes the notice.

This page does not check the GitHub settings or the issue forms on GitHub, and it does not run the full conformance
suite on Windows against the image.
