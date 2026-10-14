import type { ReactElement } from "react";
import { PlainShell } from "./PlainShell";
import type { ShellProps } from "./types";

type RenderShell = (props: ShellProps) => ReactElement;

// Task 6 replaces the surveyjs-site entry with the real surveyjs.io shell.
const shells: Record<string, RenderShell> = {
  plain: (props) => <PlainShell {...props} />,
  "surveyjs-site": (props) => <PlainShell {...props} />,
};

/** Renders the shell named in /config; any unknown name falls back to plain. */
export function renderShell(name: string, props: ShellProps): ReactElement {
  const render = Object.hasOwn(shells, name) ? shells[name]! : shells["plain"]!;
  return render(props);
}
