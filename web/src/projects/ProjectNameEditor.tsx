import { useEffect, useRef, useState } from "react";
import { SiteButton } from "../shell/surveyjs-site/SiteButton";
import { projectErrorText } from "./messages";
import styles from "./ProjectsPage.module.css";

/**
 * The project name editor of the site's Projects page (a new project, or a rename): the name in a text box,
 * Save and Cancel. It opens focused; Enter saves. Save sends the name as typed and waits for the
 * server: success closes the editor, a refusal shows under it and the editor stays.
 */
export function ProjectNameEditor({
  name = "",
  action,
  onSave,
  onClose,
}: {
  /** The current name when renaming. */
  name?: string;
  action: "create" | "rename";
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A ref, not the state: two clicks in the same tick both see the old render.
  const saving = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (failure) {
      setError(projectErrorText(failure, action));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <div className="v2-class---account-page__add-project">
        <div className="v2-class---text-edit">
          <input
            ref={inputRef}
            className="v2-class---text-edit__input"
            placeholder="Enter a project name..."
            aria-label="Project name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // The Enter that ends an IME composition only confirms the text.
                if (event.nativeEvent.isComposing) return;
                event.preventDefault();
                void save();
              }
            }}
          />
        </div>

        <div className="v2-class---account-page__actions-footer">
          <SiteButton
            text="Save"
            style="Brand"
            mode="Primary"
            size="Small"
            onClick={() => void save()}
            disabled={pending}
          />
          <a
            className="v2-class---paragraph-link"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onClose();
            }}
          >
            Cancel
          </a>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
