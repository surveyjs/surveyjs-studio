import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { Project } from "../api/projects";
import { iconHtml } from "../shell/surveyjs-site/icons";
import { surveyListSearch } from "./search";
import styles from "./SurveyListPage.module.css";

const PERSONAL = "personal";
const ITEM_LINK = "v2-class---drop-down-menu-item__link";
const SELECTED_ITEM_LINK = `${ITEM_LINK} v2-class---drop-down-menu-item__link--selected`;

/**
 * The project drop-down of the site's My Surveys page: the selected scope, and a menu of
 * links to Personal Surveys and each project's active list, then Manage Projects (the app's own
 * item, to the Projects page). A click on the button toggles the menu (as on the site); for the
 * keyboard, the button is focusable and Enter, Space or ArrowDown open it. Escape, a click outside
 * and focus leaving close it.
 */
export function ProjectSelector({
  projects,
  project,
}: {
  projects: Project[];
  /** `personal` or the id of the selected project. */
  project: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const selectedId = project.toLowerCase();
  const selected = projects.find((item) => item.id.toLowerCase() === selectedId);
  const selectedName = project === PERSONAL ? "Personal Surveys" : (selected?.name ?? project);

  const rootClass = [
    "v2-class---drop-down-button v2-class---drop-down-button__selected-item",
    open ? "v2-class---drop-down-button--open" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rootRef}
      className={rootClass}
      onClick={(event) => {
        // Clicks on the menu's links are handled by the links (the site stops them there).
        if (event.target instanceof Element && event.target.closest("a")) return;
        setOpen((wasOpen) => !wasOpen);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div
        ref={triggerRef}
        className={`v2-class---drop-down-button__selected-item-button ${styles.trigger}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
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
        <div
          className="v2-class---drop-down-button__selected-item-icon-container"
          dangerouslySetInnerHTML={iconHtml("16x16/Projects")}
        />
        <span className="v2-class---drop-down-button__selected-item-button-text">
          {selectedName}
        </span>
        <span className={styles.icon} dangerouslySetInnerHTML={iconHtml("12x12/Drop-Down-Arrow")} />
      </div>

      <div
        id={menuId}
        className="v2-class---drop-down-menu v2-class---drop-down-menu--popup-menu"
        hidden={!open}
        // Focusable without a tab stop: WebKit does not focus a clicked link, so a mousedown on an
        // item would otherwise blur the trigger with no relatedTarget and close the menu before
        // the click lands. With this, focus moves to the menu, inside the root.
        tabIndex={-1}
      >
        <ul className="v2-class---drop-down-menu__list">
          <ProjectItem
            name="Personal Surveys"
            project={PERSONAL}
            selected={project === PERSONAL}
            onSelect={() => setOpen(false)}
          />
          {projects.map((item) => (
            <ProjectItem
              key={item.id}
              name={item.name}
              project={item.id}
              selected={item.id.toLowerCase() === selectedId}
              onSelect={() => setOpen(false)}
            />
          ))}
          <li className="v2-class---drop-down-menu-item">
            <Link className={ITEM_LINK} to="/projects" onClick={() => setOpen(false)}>
              <span className="v2-class---drop-down-menu-item__text">Manage Projects</span>
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** One menu item: a link to the scope's active list, as the site's links are. */
function ProjectItem({
  name,
  project,
  selected,
  onSelect,
}: {
  name: string;
  project: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="v2-class---drop-down-menu-item">
      <Link
        className={selected ? SELECTED_ITEM_LINK : ITEM_LINK}
        to="/"
        search={surveyListSearch({ project, archived: false })}
        // The router marks the link of the exact current URL with aria-current; it adds no class.
        activeOptions={{ exact: true }}
        activeProps={{}}
        onClick={onSelect}
      >
        <span className="v2-class---drop-down-menu-item__text">{name}</span>
      </Link>
    </li>
  );
}
