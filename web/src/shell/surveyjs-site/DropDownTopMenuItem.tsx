import { useId, useRef, useState, type ReactNode } from "react";
import { iconHtml } from "./icons";
import styles from "./SurveyjsSiteShell.module.css";

export interface DropDownTopMenuItemProps {
  /** The item's label (the site's `aria-label` on the `<li>`). */
  label: string;
  /** Extra classes of the `<li>`, such as `v2-class---top-menu-item--drop-down-account`. */
  modifier?: string;
  /** Extra classes of the popup `<nav>`, such as `v2-class---drop-down-menu--account`. */
  menuModifier?: string;
  /** What the trigger shows before the drop-down arrow. */
  trigger: ReactNode;
  /** The popup's content. */
  children: ReactNode;
}

/**
 * A top-bar item with a drop-down menu (`the site's page markup`, type `Drop-Down`). For
 * the mouse, the site's CSS opens the menu on hover. The site offers no keyboard access, so the
 * trigger is also a focusable button: Enter, Space or ArrowDown opens the menu (glue class
 * `dropDownOpen` applies the site's hover styles), Escape closes it and returns focus to the
 * trigger, and the menu closes when focus leaves the item.
 */
export function DropDownTopMenuItem({
  label,
  modifier,
  menuModifier,
  trigger,
  children,
}: DropDownTopMenuItemProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();

  const itemClass = [
    "v2-class---top-menu-item",
    modifier,
    "v2-class---top-menu-item--drop-down",
    open ? styles.dropDownOpen : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const menuClass = [
    "v2-class---drop-down-menu v2-class---drop-down-menu--popup-menu",
    menuModifier,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={itemClass}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <span
        ref={triggerRef}
        className="v2-class---top-menu-item--drop-down__content"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open || hovered}
        aria-controls={menuId}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((wasOpen) => !wasOpen);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
        <span
          className="v2-class---top-menu-item__icon v2-class---top-menu-item__icon--drop-down"
          dangerouslySetInnerHTML={iconHtml("top-bar/Drop-Down-Arrow")}
        />
      </span>
      <nav id={menuId} className={menuClass}>
        {children}
      </nav>
    </li>
  );
}
