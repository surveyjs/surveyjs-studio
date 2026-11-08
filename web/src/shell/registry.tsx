import { lazy, Suspense, type ReactElement, type ReactNode } from "react";
import type { components } from "@surveyjs-studio/contract/types";
import type { RunBrandInfo } from "../run/RunSurvey";
import { AnonymousShell, PlainShell } from "./PlainShell";
import { DEFAULT_BRANDING, type ShellProps } from "./types";

type AppConfig = components["schemas"]["AppConfig"];

/** The self-hosted shell's name (APP_SHELL=self-hosted). */
export const SELF_HOSTED_SHELL = "self-hosted";

/** The surveyjs.io shell's name (APP_SHELL=surveyjs-site, the default). */
const SITE_SHELL = "surveyjs-site";

type RenderShell = (props: ShellProps) => ReactElement;
type RenderStyles = (children: ReactNode) => ReactElement;

// Loaded on demand, so the surveyjs.io styles (which also style <body>) and fonts reach the
// browser only when this shell is configured.
const SurveyjsSiteShell = lazy(async () => ({
  default: (await import("./surveyjs-site/SurveyjsSiteShell")).SurveyjsSiteShell,
}));
const SurveyjsSiteStyles = lazy(async () => ({
  default: (await import("./surveyjs-site/SiteStyles")).SiteStyles,
}));

// The self-hosted shell, its frame and its footer, loaded on demand too: its own stylesheets reach
// the browser only with APP_SHELL=self-hosted.
const selfHosted = () => import("./self-hosted/SelfHostedShell");
const SelfHostedShell = lazy(async () => ({ default: (await selfHosted()).SelfHostedShell }));
const SelfHostedFrame = lazy(async () => ({ default: (await selfHosted()).SelfHostedFrame }));
const SelfHostedFooter = lazy(async () => ({ default: (await selfHosted()).SelfHostedFooter }));

const shells: Record<string, RenderShell> = {
  plain: (props) => <PlainShell {...props} />,
  [SELF_HOSTED_SHELL]: (props) => (
    <Suspense fallback={null}>
      <SelfHostedShell {...props} branding={props.branding ?? DEFAULT_BRANDING} />
    </Suspense>
  ),
  "surveyjs-site": (props) => (
    <Suspense fallback={null}>
      <SurveyjsSiteShell {...props} />
    </Suspense>
  ),
};

const shellStyles: Record<string, RenderStyles> = {
  plain: (children) => <>{children}</>,
  "surveyjs-site": (children) => (
    <Suspense fallback={null}>
      <SurveyjsSiteStyles>{children}</SurveyjsSiteStyles>
    </Suspense>
  ),
};

/** Renders the shell named in /config; any unknown name falls back to plain. */
export function renderShell(name: string, props: ShellProps): ReactElement {
  const render = Object.hasOwn(shells, name) ? shells[name]! : shells["plain"]!;
  return render(props);
}

/**
 * A page of a visitor who is not signed in (sign-in, set-password): the self-hosted frame with the
 * instance's branding; in the surveyjs-site shell the site's styles around a `<main>` as tall as the
 * window (the page's own container draws the page, without the site's header and footer); else the
 * plain frame without account controls.
 */
export function renderAnonymousPage(config: AppConfig, children: ReactNode): ReactElement {
  if (config.shell === SELF_HOSTED_SHELL) {
    return (
      <Suspense fallback={null}>
        <SelfHostedFrame branding={config.branding ?? DEFAULT_BRANDING}>{children}</SelfHostedFrame>
      </Suspense>
    );
  }
  if (config.shell === SITE_SHELL) {
    return renderShellStyles(config.shell, <main style={{ minHeight: "100vh" }}>{children}</main>);
  }
  return renderShellStyles(config.shell, <AnonymousShell>{children}</AnonymousShell>);
}

/**
 * The public results page: the self-hosted frame with the instance's branding (the page brings its
 * own `<main>`), else no shell but the configured shell's styles (ADR 0016 R19).
 */
export function renderPublicPage(config: AppConfig, children: ReactNode): ReactElement {
  if (config.shell === SELF_HOSTED_SHELL) {
    return (
      <Suspense fallback={null}>
        <SelfHostedFrame branding={config.branding ?? DEFAULT_BRANDING} ownMain>
          {children}
        </SelfHostedFrame>
      </Suspense>
    );
  }
  return renderShellStyles(config.shell, children);
}

/**
 * The brand block under a running survey: in the self-hosted shell the block with the logo from the
 * app (S11: no calls to other sites), unless BRANDING=off; else the library's own, as surveyjs.io.
 */
export function runBrandInfo(config: AppConfig): RunBrandInfo {
  if (config.shell !== SELF_HOSTED_SHELL) return "library";
  return (config.branding ?? DEFAULT_BRANDING).poweredBy ? "bundled" : "none";
}

/** The run page's footer: the self-hosted footer in that shell, else nothing. */
export function renderRunFooter(config: AppConfig): ReactElement | null {
  if (config.shell !== SELF_HOSTED_SHELL) return null;
  return (
    <Suspense fallback={null}>
      <SelfHostedFooter branding={config.branding ?? DEFAULT_BRANDING} standalone />
    </Suspense>
  );
}

/**
 * Renders a page that has no shell (the public results page) with the styles of the shell named in
 * /config, and none of its header, footer or dialogs. `plain`, and any unknown name, adds no styles.
 */
export function renderShellStyles(name: string, children: ReactNode): ReactElement {
  const render = Object.hasOwn(shellStyles, name) ? shellStyles[name]! : shellStyles["plain"]!;
  return render(children);
}
