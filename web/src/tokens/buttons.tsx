import type { ReactNode } from "react";

// The site's button classes (button.scss), as the Users page uses them.
export const PRIMARY =
  "v2-class---button v2-class---button--brand-primary v2-class---button--small";
export const SECONDARY =
  "v2-class---button v2-class---button--brand-secondary v2-class---button--small";
export const ACTION =
  "v2-class---button v2-class---button--brand-secondary v2-class---button--x-small";
export const DANGER =
  "v2-class---button v2-class---button--alert-secondary v2-class---button--x-small";

/** A button's text in the site's type for its size. */
export function ButtonText({
  size = "small",
  children,
}: {
  size?: "small" | "x-small";
  children: ReactNode;
}) {
  return (
    <span className={`v2-class---button__text v2-class---button__text--${size}`}>{children}</span>
  );
}
