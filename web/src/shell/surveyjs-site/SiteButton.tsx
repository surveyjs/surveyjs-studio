import type { MouseEventHandler } from "react";

export interface SiteButtonProps {
  text: string;
  /** `Brand`, `Accent`, … (the site's `Style`). */
  style: string;
  /** `Primary`, `Secondary`, `Tertiary` (the site's `Mode`). */
  mode: string;
  /** `Medium`, `X-Small`, `Medium-Adaptive`, … (the site's `Size`). */
  size: string;
  href?: string;
  /** For a button that runs an action (the site's `OnClick` with `href="#"`). */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** The site's `components/Button` partial: an anchor styled as a button. */
export function SiteButton({ text, style, mode, size, href, onClick }: SiteButtonProps) {
  const sizeClass = size.toLowerCase();
  const className = `v2-class---button v2-class---button--${style.toLowerCase()}-${mode.toLowerCase()} v2-class---button--${sizeClass} `;
  const action = href === undefined;
  return (
    <a
      className={className}
      href={href ?? "#"}
      role={action ? "button" : undefined}
      onClick={(event) => {
        if (action) event.preventDefault();
        onClick?.(event);
      }}
    >
      <span className={`v2-class---button__text v2-class---button__text--${sizeClass}`}>
        {text}
      </span>
    </a>
  );
}
