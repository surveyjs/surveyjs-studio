import { useId, useState } from "react";
import { useUpdateSurvey, type Survey } from "../api/surveys";
import { SiteButton } from "../shell/surveyjs-site/SiteButton";
import { useRenameEditor } from "../surveyList/useRenameEditor";

/**
 * The survey name in the editor's bottom bar, with its rename editor, as `the site's page markup` has it.
 * A click on the name opens the editor with the name; Enter, Save or leaving the box saves, Escape or
 * Cancel restores the name. A blank or unchanged name sends nothing. Saving closes the editor at once
 * and shows the new name; when the rename fails the old name returns and `onRenamed(false)` is
 * called. Without modify rights the name cannot be edited.
 */
export function FooterNameEditor({
  survey,
  readOnly,
  onRenameStart,
  onRenamed,
}: {
  survey: Survey;
  readOnly: boolean;
  /** A rename is sent. */
  onRenameStart: () => void;
  /** The rename ended: saved or not. */
  onRenamed: (ok: boolean) => void;
}) {
  const update = useUpdateSurvey();
  const [editingName, setEditingName] = useState("");
  const { name, editing, pencilRef, startEdit, cancel, save } = useRenameEditor(
    survey.name,
    (value) => {
      onRenameStart();
      return update.mutateAsync({ survey, patch: { name: value } }).then(
        () => onRenamed(true),
        () => onRenamed(false),
      );
    },
  );

  const open = () => {
    if (!readOnly && startEdit()) setEditingName(name);
  };

  return (
    <>
      {editing && (
        <div className="v2-class---my-surveys-page__edit-survey-name-container">
          <div className="v2-class---text-edit">
            <input
              className="v2-class---text-edit__input"
              placeholder="Enter a survey name..."
              aria-label="Survey name"
              maxLength={200}
              autoFocus
              value={editingName}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setEditingName(event.target.value)}
              onBlur={() => save(editingName, false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save(editingName);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
            />
          </div>

          <div className="v2-class---my-surveys-page__actions-footer">
            {/* A press keeps the focus in the box, so the box's blur does not save first. */}
            <div onMouseDown={(event) => event.preventDefault()}>
              <SiteButton
                text="Save"
                style="Brand"
                mode="Tertiary"
                size="Small"
                disabled={editingName === ""}
                onClick={() => save(editingName)}
              />
            </div>

            <div
              onMouseDown={(event) => {
                event.preventDefault();
                cancel();
              }}
            >
              <SiteButton
                text="Cancel"
                style="Brand"
                mode="Tertiary"
                size="Small"
                onClick={() => cancel()}
              />
            </div>
          </div>
        </div>
      )}

      <div
        className="v2-class---my-surveys-page__survey-name-container"
        style={editing ? { display: "none" } : readOnly ? { cursor: "default" } : undefined}
        onClick={open}
      >
        <span className="v2-class---my-surveys-page__survey-name" title={name}>
          {name}
        </span>
        {!readOnly && (
          <a
            ref={pencilRef}
            href="#"
            style={{ position: "relative" }}
            aria-label="Rename survey"
            onClick={(event) => event.preventDefault()}
          >
            <PencilIcon />
          </a>
        )}
      </div>
    </>
  );
}

/** The pencil of `the site's page markup`, with its clip-path id made unique. */
function PencilIcon() {
  const clipId = useId();
  return (
    <div className="v2-class---my-surveys-page__edit-icon">
      <svg
        width="13"
        height="12"
        viewBox="0 0 13 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath={`url(#${clipId})`}>
          <path d="M11.99 2.1L10.4 0.51C10.0625 0.1725 9.62 0 9.17 0C8.72 0 8.285 0.1725 7.94 0.51L2.0225 6.4275C1.0475 7.4025 0.5 8.73 0.5 10.11V11.4225C0.5 11.745 0.7625 12 1.0775 12H2.39C3.77 12 5.09 11.4525 6.0725 10.4775L11.9975 4.5525C12.6725 3.8775 12.6725 2.775 11.9975 2.1H11.99ZM5.0075 9.4125C4.31 10.11 3.38 10.5 2.39 10.5H2V10.11C2 9.12 2.3825 8.19 3.0875 7.4925L6.5075 4.0725L8.435 6L5.015 9.42L5.0075 9.4125ZM10.9325 3.4875L9.4925 4.9275L7.565 3L9.005 1.56C9.065 1.5 9.125 1.4925 9.17 1.4925C9.215 1.4925 9.2825 1.5075 9.335 1.56L10.9325 3.1575C11.0225 3.2475 11.0225 3.3975 10.9325 3.4875Z" />
        </g>
        <defs>
          <clipPath id={clipId}>
            <rect width="12" height="12" fill="white" transform="translate(0.5)" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}
