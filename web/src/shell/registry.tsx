import { lazy, Suspense, type ReactElement, type ReactNode } from "react";
import { PlainShell } from "./PlainShell";
import type { ShellProps } from "./types";

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

const shells: Record<string, RenderShell> = {
  plain: (props) => <PlainShell {...props} />,
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
 * Renders a page that has no shell (the public results page) with the styles of the shell named in
 * /config, and none of its header, footer or dialogs. `plain`, and any unknown name, adds no styles.
 */
export function renderShellStyles(name: string, children: ReactNode): ReactElement {
  const render = Object.hasOwn(shellStyles, name) ? shellStyles[name]! : shellStyles["plain"]!;
  return render(children);
}
