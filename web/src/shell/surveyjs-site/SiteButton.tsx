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
  /** Ignores clicks and gets the site's `[disabled]` look (button.scss). */
  disabled?: boolean;
}

/** The site's `components/Button` partial: an anchor styled as a button. */
export function SiteButton({ text, style, mode, size, href, onClick, disabled }: SiteButtonProps) {
  const sizeClass = size.toLowerCase();
  const className = `v2-class---button v2-class---button--${style.toLowerCase()}-${mode.toLowerCase()} v2-class---button--${sizeClass} `;
  const action = href === undefined;
  // React types have no `disabled` on <a>, but the site's styles select `[disabled]`.
  const disabledAttribute: object = disabled ? { disabled: true } : {};
  return (
    <a
      className={className}
      href={href ?? "#"}
      role={action ? "button" : undefined}
      aria-disabled={disabled || undefined}
      {...disabledAttribute}
      onClick={(event) => {
        if (action || disabled) event.preventDefault();
        if (!disabled) onClick?.(event);
      }}
    >
      <span className={`v2-class---button__text v2-class---button__text--${sizeClass}`}>
        {text}
      </span>
    </a>
  );
}
