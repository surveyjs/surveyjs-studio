import { useEffect, useRef, useState } from "react";
import { iconHtml } from "../shell/surveyjs-site/icons";
import { SiteButton } from "../shell/surveyjs-site/SiteButton";
import styles from "./ProjectsPage.module.css";

/**
 * "Add a New Member" of a project card (`the site's page markup`, admins): the button, or the email box
 * with Add and Cancel. Add waits for the server: success clears and closes the form, a refusal
 * keeps it open with the address (the card shows the error).
 */
export function AddMemberForm({ onAdd }: { onAdd: (email: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A ref, not the state: two clicks in the same tick both see the old render.
  const adding = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const add = async () => {
    if (adding.current) return;
    adding.current = true;
    setPending(true);
    try {
      if (await onAdd(value.trim())) {
        setValue("");
        setOpen(false);
      }
    } finally {
      adding.current = false;
      setPending(false);
    }
  };

  if (!open) {
    return (
      <div
        className="v2-class---add-assignment__button"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.icon} dangerouslySetInnerHTML={iconHtml("pages/account/Add")} />
        <span className="v2-class---add-assignment__button-text">Add a New Member</span>
      </div>
    );
  }

  return (
    <div className="v2-class---account-page__project-add-user-container">
      <div className="v2-class---text-edit">
        <input
          ref={inputRef}
          className="v2-class---text-edit__input"
          type="email"
          placeholder="Enter the new member's email..."
          aria-label="New member's email"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
      </div>

      <div className="v2-class---account-page__actions-footer">
        <SiteButton
          text="Add"
          style="Brand"
          mode="Primary"
          size="Small"
          onClick={() => void add()}
          disabled={pending}
        />
        <a
          className="v2-class---paragraph-link"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          Cancel
        </a>
      </div>
    </div>
  );
}
