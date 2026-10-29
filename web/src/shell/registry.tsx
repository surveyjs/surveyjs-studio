import { lazy, Suspense, type ReactElement, type ReactNode } from "react";
import type { components } from "@surveyjs-studio/contract/types";
import { AnonymousShell, PlainShell } from "./PlainShell";
import { PoweredByFooter, PoweredByFrame, PoweredByShell } from "./powered-by/PoweredByShell";
import { DEFAULT_BRANDING, type ShellProps } from "./types";

type AppConfig = components["schemas"]["AppConfig"];

/** The self-hosted shell's name (APP_SHELL=powered-by). */
export const POWERED_BY_SHELL = "powered-by";

type RenderShell = (props: ShellProps) => ReactElement;
type RenderStyles = (children: ReactNode) => ReactElement;

// Loaded on demand, so the surveyjs.io styles (which also style <body>) and fonts reach the
// browser only when a shell that uses them (surveyjs-site, powered-by) is configured.
const SurveyjsSiteShell = lazy(async () => ({
  default: (await import("./surveyjs-site/SurveyjsSiteShell")).SurveyjsSiteShell,
}));
const SurveyjsSiteStyles = lazy(async () => ({
  default: (await import("./surveyjs-site/SiteStyles")).SiteStyles,
}));

/** The site's component styles (not its header or footer): the powered-by pages use them too. */
const siteStyles: RenderStyles = (children) => (
  <Suspense fallback={null}>
    <SurveyjsSiteStyles>{children}</SurveyjsSiteStyles>
  </Suspense>
);

const shells: Record<string, RenderShell> = {
  plain: (props) => <PlainShell {...props} />,
  // The pages' content is built from the site's components, so it takes the site's styles.
  [POWERED_BY_SHELL]: (props) =>
    siteStyles(<PoweredByShell {...props} branding={props.branding ?? DEFAULT_BRANDING} />),
  "surveyjs-site": (props) => (
    <Suspense fallback={null}>
      <SurveyjsSiteShell {...props} />
    </Suspense>
  ),
};

const shellStyles: Record<string, RenderStyles> = {
  plain: (children) => <>{children}</>,
  [POWERED_BY_SHELL]: siteStyles,
  "surveyjs-site": siteStyles,
};

/** Renders the shell named in /config; any unknown name falls back to plain. */
export function renderShell(name: string, props: ShellProps): ReactElement {
  const render = Object.hasOwn(shells, name) ? shells[name]! : shells["plain"]!;
  return render(props);
}

/**
 * A page of a visitor who is not signed in (sign-in, set-password): the powered-by frame with the
 * instance's branding, else the configured shell's styles around the plain frame without account
 * controls.
 */
export function renderAnonymousPage(config: AppConfig, children: ReactNode): ReactElement {
  if (config.shell === POWERED_BY_SHELL) {
    return siteStyles(
      <PoweredByFrame branding={config.branding ?? DEFAULT_BRANDING}>{children}</PoweredByFrame>,
    );
  }
  return renderShellStyles(config.shell, <AnonymousShell>{children}</AnonymousShell>);
}

/**
 * The public results page: the powered-by frame with the instance's branding (the page follows that
 * shell), else no shell but the configured shell's styles (ADR 0016 R19).
 */
export function renderPublicPage(config: AppConfig, children: ReactNode): ReactElement {
  if (config.shell === POWERED_BY_SHELL) {
    // The page brings its own <main>.
    return siteStyles(
      <PoweredByFrame branding={config.branding ?? DEFAULT_BRANDING} ownMain>
        {children}
      </PoweredByFrame>,
    );
  }
  return renderShellStyles(config.shell, children);
}

/** The run page's footer: the powered-by footer in that shell, else nothing. */
export function renderRunFooter(config: AppConfig): ReactElement | null {
  if (config.shell !== POWERED_BY_SHELL) return null;
  return <PoweredByFooter branding={config.branding ?? DEFAULT_BRANDING} />;
}

/**
 * Renders a page that has no shell (the public results page) with the styles of the shell named in
 * /config, and none of its header, footer or dialogs. `plain`, and any unknown name, adds no styles.
 */
export function renderShellStyles(name: string, children: ReactNode): ReactElement {
  const render = Object.hasOwn(shellStyles, name) ? shellStyles[name]! : shellStyles["plain"]!;
  return render(children);
}
