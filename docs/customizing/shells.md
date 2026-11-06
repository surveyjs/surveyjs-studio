# Writing your own shell

The shell is the frame around every signed-in page: the header, the account controls, the notices and the footer. You
choose it with `APP_SHELL`. This page builds a small one, `example`, from files you can copy. The guide's code is
tested: `pnpm check:example-shell` applies it to a scratch copy of the repository, typechecks it and runs its test, so
it stays true. See [Licensing](licensing.md) before you ship a shell of your own.

## What a shell is

The app asks the server for its [configuration](../operations.md), reads `shell`, and calls `renderShell(name, props)`
in `web/src/shell/registry.tsx`. The registry is a record of names to render functions. The names that ship are
`plain`, `self-hosted` and `surveyjs-site`. An unknown name falls back to `plain`, so a typo in `APP_SHELL` never
leaves the app without a frame.

A shell is a React component that takes `ShellProps` and renders `children` somewhere inside it. It has no router: the
app passes links as data.

## The `ShellProps` interface

The interface is in `web/src/shell/types.ts`.

| Field                                                         | What to do with it                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `user`                                                        | The signed-in user. Show `user.displayName`; `avatarUrl` can be `null`.                                      |
| `notices`                                                     | Messages for the user, each with a `code` and a `message`. Render them all. `actionUrl` is an optional link. |
| `links`                                                       | The `/config.links` map of name to URL. Render it as a navigation of plain links, or ignore it.              |
| `onSignOut`                                                   | Call it from your Sign Out button.                                                                           |
| `signingOut`                                                  | True while signing out. Disable the Sign Out button.                                                         |
| `signOutError`                                                | A message to show when signing out failed.                                                                   |
| `projectsLink`, `changePasswordLink`, `usersLink`, `homeLink` | In-app links, each with an `href` and a `navigate` function. Each is set only when it applies to the user.   |
| `branding`                                                    | `/config.branding` (name, logo, accent colour, legal links). Optional: use it or ignore it.                  |
| `children`                                                    | The page. Render it once, in a `<main>`.                                                                     |

Render an in-app link as an `<a href={link.href}>` with `onClick={followAppLink(link)}`. A plain left click then
navigates inside the app, and a click with another button or a modifier key opens a new tab as the browser does.

## The example

Three pieces: the shell, its test, and one line in the registry. All three live in your fork, and the shell and its
test sit in their own folder, so a merge from upstream rarely touches them.

The shell shows the name "Example Studio", the user's name, **Projects** when the app gives the link, and **Sign Out**.
Then it renders the page.

<!-- file: web/src/shell/example/ExampleShell.tsx -->

```tsx
import { followAppLink, type ShellProps } from "../types";

/** An example shell: a header with the app name, the user and Sign Out, then the page. */
export function ExampleShell({
  user,
  notices,
  signingOut,
  signOutError,
  onSignOut,
  projectsLink,
  children,
}: ShellProps) {
  return (
    <>
      <header>
        <h1>Example Studio</h1>
        {projectsLink && (
          <a href={projectsLink.href} onClick={followAppLink(projectsLink)}>
            Projects
          </a>
        )}
        <span>{user.displayName}</span>
        <button type="button" onClick={onSignOut} disabled={signingOut}>
          Sign Out
        </button>
      </header>
      {signOutError && <div role="alert">{signOutError}</div>}
      {notices.map((notice) => (
        <div key={notice.code} role="status">
          {notice.message}
        </div>
      ))}
      <main>{children}</main>
    </>
  );
}
```

The test renders it through the registry, the way the app does, and checks the name, the user and Sign Out.

<!-- file: web/src/shell/example/ExampleShell.test.tsx -->

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUser } from "../../test/server";
import { renderShell } from "../registry";

describe("the example shell", () => {
  it("frames the page with the app name, the user and a Sign Out button", () => {
    const onSignOut = vi.fn();
    render(
      renderShell("example", {
        user: currentUser,
        notices: [],
        links: {},
        onSignOut,
        children: <p>page</p>,
      }),
    );
    expect(screen.getByRole("heading", { name: "Example Studio" })).toBeTruthy();
    expect(screen.getByText(currentUser.displayName)).toBeTruthy();
    expect(screen.getByText("page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
```

Register the shell. This is the whole change to a file that upstream owns:

<!-- patch -->

```diff
diff --git a/web/src/shell/registry.tsx b/web/src/shell/registry.tsx
index 3a0776a..bbcfd7e 100644
--- a/web/src/shell/registry.tsx
+++ b/web/src/shell/registry.tsx
@@ -2,6 +2,7 @@ import { lazy, Suspense, type ReactElement, type ReactNode } from "react";
 import type { components } from "@surveyjs-studio/contract/types";
 import type { RunBrandInfo } from "../run/RunSurvey";
 import { AnonymousShell, PlainShell } from "./PlainShell";
+import { ExampleShell } from "./example/ExampleShell";
 import { DEFAULT_BRANDING, type ShellProps } from "./types";

 type AppConfig = components["schemas"]["AppConfig"];
@@ -33,6 +34,7 @@ const SelfHostedFooter = lazy(async () => ({ default: (await selfHosted()).SelfH

 const shells: Record<string, RenderShell> = {
   plain: (props) => <PlainShell {...props} />,
+  example: (props) => <ExampleShell {...props} />,
   [SELF_HOSTED_SHELL]: (props) => (
     <Suspense fallback={null}>
       <SelfHostedShell {...props} branding={props.branding ?? DEFAULT_BRANDING} />
```

Run the web tests of your shell with `pnpm exec vitest run web/src/shell/example`.

## Run it

Start the server with the shell's name:

```text
APP_SHELL=example
```

Other settings are not tied to the shell, with three exceptions. These stay off for any shell but `surveyjs-site`:

| Feature    | Without `surveyjs-site`                                                     |
| ---------- | --------------------------------------------------------------------------- |
| Embed      | Off in `/config`; the web app does not offer it.                            |
| API docs   | `API_DOCS=true` is refused at start-up, because only that shell shows them. |
| API tokens | Off in `/config`; the web app does not offer them.                          |

The server accepts any `APP_SHELL` text. It does not check the name against the web app's registry, so spell it as in
`registry.tsx`. To ship it in a container, build the image from your fork as in [Running](../running.md).

## Licensing

A custom shell makes your instance a modified copy of Studio, which is mode 3 in [Licensing](licensing.md). The page
says what that asks of you, and which parts of the product need a licence of their own.

## Keeping a fork up to date

1. Add this repository as a remote once: `git remote add upstream <the repository's address>`.
2. To update, run `git fetch upstream` and merge or rebase the release tag you want.
3. Keep your changes small. Your shell lives in its own folder, and the only upstream file you edit is
   `registry.tsx`, by one import and one line. A conflict there is easy to resolve.
4. After each merge run `pnpm typecheck` and your shell's test. If `ShellProps` changed, they point at what to update.
5. Run the [conformance suite](porting.md) if you also changed the server.
