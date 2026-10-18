import type { MouseEventHandler, ReactNode } from "react";
import { followAppLink, type ShellAppLink } from "../types";
import { iconHtml } from "./icons";
import { isExternal, siteUrl } from "./site";
import { CircleIcon } from "./SiteIcon";

export interface DropDownMenuItemProps {
  text: string;
  /** A site path (`/pricing`) or an absolute URL. */
  url: string;
  /** Whether the link opens in a new tab with the external-link icon; by default as on the site. */
  external?: boolean;
  icon?: string;
  iconType?: string;
  /** A badge after the text, such as `New`. */
  tag?: string;
  classMod?: string;
  /** Makes the item an action (`role="button"`) instead of a link. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  disabled?: boolean;
}

/** The site's `components/Drop-Down-Menu-Item` partial: one item of a drop-down menu. */
export function DropDownMenuItem({
  text,
  url,
  external = isExternal(url),
  icon,
  iconType,
  tag,
  classMod,
  onClick,
  disabled,
}: DropDownMenuItemProps) {
  const className = classMod
    ? `v2-class---drop-down-menu-item ${classMod}`
    : "v2-class---drop-down-menu-item";
  return (
    <li className={className} data-text={text}>
      <a
        href={onClick ? "#" : siteUrl(url)}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener" : undefined}
        role={onClick ? "button" : undefined}
        aria-disabled={disabled || undefined}
        className="v2-class---drop-down-menu-item__link v2-class---drop-down-menu-item__link--no-wrap"
        onClick={
          onClick &&
          ((event) => {
            event.preventDefault();
            if (!disabled) onClick(event);
          })
        }
      >
        {icon && iconType && (
          <span className="v2-class---drop-down-menu-item__icon">
            <CircleIcon name={icon} type={iconType} />
          </span>
        )}
        <span className="v2-class---drop-down-menu-item__text">
          {text}
          {tag && (
            <>
              <span className="v2-class---drop-down-menu-item__badge-gap"></span>
              <Badge text={tag} />
            </>
          )}
          {external && (
            <span
              className="v2-class---drop-down-menu-item__icon-external"
              dangerouslySetInnerHTML={iconHtml("External-Link")}
            />
          )}
        </span>
      </a>
    </li>
  );
}

/**
 * A drop-down menu item that opens a page of the app: the markup of `DropDownMenuItem` with the
 * link's `href`, navigating in the app on a plain left click.
 */
export function AppMenuItem({ text, link }: { text: string; link: ShellAppLink }) {
  return (
    <li className="v2-class---drop-down-menu-item" data-text={text}>
      <a
        href={link.href}
        className="v2-class---drop-down-menu-item__link v2-class---drop-down-menu-item__link--no-wrap"
        onClick={followAppLink(link)}
      >
        <span className="v2-class---drop-down-menu-item__text">{text}</span>
      </a>
    </li>
  );
}

/** A group title inside a drop-down menu (the partial with `IsGroupTitle`). */
export function DropDownMenuGroupTitle({ text }: { text: string }) {
  return (
    <li
      className="v2-class---drop-down-menu-item v2-class---drop-down-menu-item--group-title"
      data-text={text}
    >
      <h3 className="v2-class---drop-down-menu-item__group-title">{text}</h3>
    </li>
  );
}

/** A separator inside a drop-down menu (the partial with the text `Separator`). */
export function DropDownMenuSeparator() {
  return (
    <div className="v2-class---drop-down-menu-item--separator">
      <div className="v2-class---drop-down-menu-item__separator"></div>
    </div>
  );
}

/** The site's compact `components/Badge` (only the `New` badge appears in the menus). */
function Badge({ text }: { text: string }): ReactNode {
  const label = text.toLowerCase() === "new" ? "New" : text;
  const modifier = label === "New" ? " v2-class---badge--new" : "";
  return <span className={`v2-class---badge v2-class---badge--compact${modifier}`}>{label}</span>;
}
