import { useEffect, useRef, useState } from "react";
import { SiteButton } from "../shell/surveyjs-site/SiteButton";

/**
 * The inline rename editor of `the site's page markup`: the name in a text box, Save and Cancel. Enter
 * saves and Escape cancels, as on the site; the box opens focused with the name selected.
 */
export function SurveyNameEditor({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  /** The value as typed. */
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="v2-class---my-surveys-page__edit-survey-name-container">
      <div className="v2-class---text-edit">
        <input
          ref={inputRef}
          className="v2-class---text-edit__input"
          placeholder="Enter a survey name..."
          maxLength={200}
          aria-label="Survey name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSave(value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
      <div className="v2-class---my-surveys-page__actions-footer">
        <div>
          <SiteButton
            text="Save"
            style="Brand"
            mode="Primary"
            size="Small"
            onClick={() => onSave(value)}
          />
        </div>
        <a
          className="v2-class---paragraph-link"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onCancel();
          }}
        >
          Cancel
        </a>
      </div>
    </div>
  );
}
