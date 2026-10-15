import { useId } from "react";
import type { Survey } from "../api/surveys";
import { formatListDate } from "./formatDate";

/**
 * One survey of the list, in the row markup of `the site's page markup` (table view)
 * without the rename editor, the pencil and the "…" menu (Step 5).
 */
export function SurveyRow({ survey }: { survey: Survey }) {
  return (
    <div className="v2-class---my-surveys-page__list-item">
      <div className="v2-class---my-surveys-page__list-item-content">
        <div className="v2-class---my-surveys-page__list-item-header">
          <div className="v2-class---my-surveys-page__survey-name-container">
            <span className="v2-class---my-surveys-page__survey-name" title={survey.name}>
              {survey.name}
            </span>
          </div>

          <div className="v2-class---my-surveys-page__survey-details-container">
            <div className="v2-class---my-surveys-page__survey-date-item" title="Created on">
              <div className="v2-class---my-surveys-page__survey-date-item-icon">
                <CreatedIcon />
              </div>
              <div className="v2-class---my-surveys-page__survey-date-item-text">
                {formatListDate(survey.createdAt)}
              </div>
            </div>

            <div className="v2-class---my-surveys-page__survey-date-item" title="Updated on">
              <div className="v2-class---my-surveys-page__survey-date-item-icon">
                <UpdatedIcon />
              </div>
              <div className="v2-class---my-surveys-page__survey-date-item-text">
                {formatListDate(survey.updatedAt)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The two date icons are inline in the site's page. The site repeats their clip-path ids in
// every row; here each row gets its own ids, so the page has no duplicate ids.

function CreatedIcon() {
  const clipId = useId();
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M1 8.75C0.59 8.75 0.25 8.41 0.25 8C0.25 7.59 0.59 7.25 1 7.25H9.19L7.47 5.53C7.18 5.24 7.18 4.76 7.47 4.47C7.76 4.18 8.24 4.18 8.53 4.47L12.06 8L8.53 11.53C8.38 11.68 8.19 11.75 8 11.75C7.81 11.75 7.62 11.68 7.47 11.53C7.18 11.24 7.18 10.76 7.47 10.47L9.19 8.75H1ZM8 0.25C5.03 0.25 2.29 1.99 1.01 4.68C0.83 5.05 0.99 5.5 1.36 5.68C1.73 5.86 2.18 5.7 2.36 5.33C3.39 3.16 5.61 1.76 8 1.76C11.45 1.76 14.25 4.56 14.25 8.01C14.25 11.46 11.45 14.26 8 14.26C5.61 14.26 3.39 12.86 2.36 10.69C2.18 10.32 1.73 10.16 1.36 10.34C0.99 10.52 0.83 10.96 1.01 11.34C2.29 14.03 5.04 15.77 8 15.77C12.27 15.77 15.75 12.29 15.75 8.02C15.75 3.75 12.27 0.25 8 0.25Z"
          fill="#8A8A8A"
        />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function UpdatedIcon() {
  const clipId = useId();
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M12 5.75C11.59 5.75 11.25 5.41 11.25 5C11.25 4.59 11.59 4.25 12 4.25H12.98C11.81 2.71 9.97 1.75 8 1.75C4.55 1.75 1.75 4.55 1.75 8C1.75 11.45 4.55 14.25 8 14.25C11.09 14.25 13.75 11.95 14.19 8.89C14.25 8.48 14.63 8.19 15.04 8.25C15.45 8.31 15.73 8.69 15.68 9.1C15.14 12.89 11.84 15.74 8.01 15.74C3.73 15.75 0.25 12.27 0.25 8C0.25 3.73 3.73 0.25 8 0.25C10.49 0.25 12.81 1.48 14.25 3.45V2C14.25 1.59 14.59 1.25 15 1.25C15.41 1.25 15.75 1.59 15.75 2V5.75H12ZM7 4.25C6.59 4.25 6.25 4.59 6.25 5V9.75H11C11.41 9.75 11.75 9.41 11.75 9C11.75 8.59 11.41 8.25 11 8.25H7.75V5C7.75 4.59 7.41 4.25 7 4.25Z"
          fill="#8A8A8A"
        />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
