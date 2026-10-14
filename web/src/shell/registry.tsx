import { lazy, Suspense, type ReactElement } from "react";
import { PlainShell } from "./PlainShell";
import type { ShellProps } from "./types";

type RenderShell = (props: ShellProps) => ReactElement;

// Loaded on demand, so the surveyjs.io styles (which also style <body>) and fonts reach the
// browser only when this shell is configured.
const SurveyjsSiteShell = lazy(async () => ({
  default: (await import("./surveyjs-site/SurveyjsSiteShell")).SurveyjsSiteShell,
}));

const shells: Record<string, RenderShell> = {
  plain: (props) => <PlainShell {...props} />,
  "surveyjs-site": (props) => (
    <Suspense fallback={null}>
      <SurveyjsSiteShell {...props} />
    </Suspense>
  ),
};

/** Renders the shell named in /config; any unknown name falls back to plain. */
export function renderShell(name: string, props: ShellProps): ReactElement {
  const render = Object.hasOwn(shells, name) ? shells[name]! : shells["plain"]!;
  return render(props);
}
