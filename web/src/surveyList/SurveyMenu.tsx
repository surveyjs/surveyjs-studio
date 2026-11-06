import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Project } from "../api/projects";
import type { Survey } from "../api/surveys";
import { MENU_LABELS, moveTargets, surveyMenuItems, type MenuEntry } from "./menuItems";
import type { SurveyAction } from "./useSurveyActions";

const ITEM = "v2-class---drop-down-menu-item";
const ITEM_LINK = "v2-class---drop-down-menu-item__link";
const SELECTED_ITEM_LINK = `${ITEM_LINK} v2-class---drop-down-menu-item__link--selected`;
const POPUP = "v2-class---drop-down-menu v2-class---drop-down-menu--popup-menu";
const LEFT = "v2-class---drop-down-menu--left";

const classes = (...names: (string | false)[]) => names.filter(Boolean).join(" ");

/** Whether a popup passes the right edge of the page (the site then opens it to the left). */
const overflowsRight = (popup: HTMLElement | null) =>
  popup !== null && popup.getBoundingClientRect().right > document.body.offsetWidth;

/**
 * The row's "…" button and its menu, in the markup of the site's My Surveys row menu button. The
 * entries are `surveyMenuItems`; links (Run, Edit, View Results, View History) navigate, the other
 * items call `onAction`. A click on the dots toggles the menu (as on the site). For the keyboard, the
 * dots are a focusable button: Enter or Space toggle it, Escape closes it and focuses the button
 * again; a mouse press outside or focus leaving the button and its menu close it.
 */
export function SurveyMenu({
  survey,
  archived,
  projects,
  open,
  onOpenChange,
  onAction,
}: {
  survey: Survey;
  archived: boolean;
  projects: readonly Project[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: SurveyAction) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open, onOpenChange]);

  // As on the site: measured once when the menu opens (the popup mounts), reset when it closes.
  // A stable callback, so it runs only then: measuring again with `--left` applied would flip back.
  const attachPopup = useCallback((popup: HTMLDivElement | null) => {
    popupRef.current = popup;
    setLeft(overflowsRight(popup));
  }, []);

  const close = () => onOpenChange(false);
  const choose = (action: SurveyAction) => {
    // Focus back on the button first, so the focus does not fall to the page when the menu goes.
    triggerRef.current?.focus();
    close();
    onAction(action);
  };

  const renderEntry = (entry: MenuEntry, index: number): ReactNode => {
    if (entry.kind === "separator") {
      // A `li` (the site has a `div` inside the `ul`).
      return (
        <li key={`separator-${index}`} className={`${ITEM}--separator`} aria-hidden="true">
          <div className="v2-class---drop-down-menu-item__separator" />
        </li>
      );
    }
    switch (entry.id) {
      case "run":
        return (
          <li key={entry.id} className={ITEM}>
            <a
              className={ITEM_LINK}
              href={`/s/${survey.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
            >
              <ItemText>{MENU_LABELS.run}</ItemText>
            </a>
          </li>
        );
      case "edit":
      case "results":
      case "history":
        return (
          <li key={entry.id} className={ITEM}>
            <Link
              className={ITEM_LINK}
              to={
                entry.id === "edit"
                  ? "/surveys/$surveyId/edit"
                  : entry.id === "results"
                    ? "/surveys/$surveyId/results"
                    : "/surveys/$surveyId/history"
              }
              params={{ surveyId: survey.id }}
              onClick={close}
            >
              <ItemText>{MENU_LABELS[entry.id]}</ItemText>
            </Link>
          </li>
        );
      case "ids":
        return (
          <Flyout key={entry.id} label={MENU_LABELS.ids}>
            {entry.children.map((id) => (
              <ActionItem key={id} label={MENU_LABELS[id]} onSelect={() => choose({ id })} />
            ))}
          </Flyout>
        );
      case "move":
        return (
          <Flyout key={entry.id} label={MENU_LABELS.move}>
            {moveTargets(survey, projects).map((target) =>
              target.clickable ? (
                <ActionItem
                  key={target.target ?? ""}
                  label={target.label}
                  onSelect={() => choose({ id: "move", target: target.target })}
                />
              ) : (
                // The survey's own scope: marked, and inert (no href, no handler), as on the site.
                <li key={target.target ?? ""} className={ITEM}>
                  <a className={target.selected ? SELECTED_ITEM_LINK : ITEM_LINK}>
                    <ItemText>{target.label}</ItemText>
                  </a>
                </li>
              ),
            )}
          </Flyout>
        );
      default: {
        const id = entry.id;
        return <ActionItem key={id} label={MENU_LABELS[id]} onSelect={() => choose({ id })} />;
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={classes(
        "v2-class---my-surveys-page__survey-context-menu-button v2-class---drop-down-button",
        open && "v2-class---drop-down-button--open",
      )}
      onClick={(event) => {
        // Clicks inside the menu belong to its items (the site ignores them here too).
        if (popupRef.current?.contains(event.target as Node)) return;
        onOpenChange(!open);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      {/* The button role is on the dots, not on this element: the menu inside it holds links. */}
      <div
        ref={triggerRef}
        className="v2-class---my-surveys-page__survey-context-menu-button-svg-container"
        role="button"
        tabIndex={0}
        aria-label="Survey actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenChange(!open);
          }
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 12C6 13.1 5.1 14 4 14C2.9 14 2 13.1 2 12C2 10.9 2.9 10 4 10C5.1 10 6 10.9 6 12ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10ZM20 10C18.9 10 18 10.9 18 12C18 13.1 18.9 14 20 14C21.1 14 22 13.1 22 12C22 10.9 21.1 10 20 10Z"
            fill="#8A8A8A"
          />
        </svg>
      </div>

      {open && (
        <div
          ref={attachPopup}
          id={menuId}
          className={classes(POPUP, left && LEFT)}
          // Focusable without a tab stop, as in ProjectSelector: WebKit does not focus a clicked
          // link, so without it a press on an item would blur the menu closed before the click.
          tabIndex={-1}
        >
          <ul className="v2-class---drop-down-menu__list">
            {surveyMenuItems(survey, { archived, hasProjects: projects.length > 0 }).map(
              renderEntry,
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemText({ children }: { children: ReactNode }) {
  return <span className="v2-class---drop-down-menu-item__text">{children}</span>;
}

/** An item that runs an action: `href="#"`, as the site's Archive item has. */
function ActionItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <li className={ITEM}>
      <a
        className={ITEM_LINK}
        href="#"
        onClick={(event) => {
          event.preventDefault();
          onSelect();
        }}
      >
        <ItemText>{label}</ItemText>
      </a>
    </li>
  );
}

/**
 * An item with a submenu (Survey IDs, Move to Project). The site opens it on hover (CSS) and on
 * touch; here a click, or Enter or Space on its text, also toggles it (`--open`). It opens to the
 * left when it would pass the right edge of the page.
 */
function Flyout({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const flyoutId = useId();

  const flipIfNeeded = () => {
    if (overflowsRight(popupRef.current)) setLeft(true);
  };
  const toggle = () => {
    const next = !open;
    // Rendered open first, so the submenu is measured where it shows (as the site's touch handler).
    flushSync(() => setOpen(next));
    if (next) flipIfNeeded();
  };

  return (
    <li className={`${ITEM} ${ITEM}--move-to-project`}>
      <div
        className="v2-class---drop-down-menu-item__link v2-class---my-surveys-page__drop-down-hover v2-class---my-surveys-page__move-to-project-menu-button"
        onPointerEnter={flipIfNeeded}
        onPointerLeave={() => {
          if (!open) setLeft(false);
        }}
        onClick={(event) => {
          if (popupRef.current?.contains(event.target as Node)) return;
          toggle();
        }}
      >
        {/* The button role is on the text: the element with the click holds the submenu's links. */}
        <span
          className="v2-class---drop-down-menu-item__text"
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={flyoutId}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        >
          {label}
        </span>
        <div className="v2-class---my-surveys-page__move-to-project-icon-container">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4.35648 11.3565L3.64648 10.6465L8.29648 5.99648L3.64648 1.35648L4.35648 0.646484L9.70648 5.99648L4.35648 11.3565Z"
              fill="#8A8A8A"
            />
          </svg>
        </div>
        <div
          ref={popupRef}
          id={flyoutId}
          className={classes(
            `v2-class---my-surveys-page__move-to-project-menu ${POPUP}`,
            open && "v2-class---drop-down-menu--open",
            left && LEFT,
          )}
        >
          <ul className="v2-class---drop-down-menu__list">{children}</ul>
        </div>
      </div>
    </li>
  );
}
