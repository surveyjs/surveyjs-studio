import styles from "./SurveyListPage.module.css";

const TEXT = "v2-class---switcher__text";
const ACTIVE_TEXT = `${TEXT} v2-class---switcher__text--active`;

/** The site's `V2/components/switcher/Switcher` partial with the texts of the My Surveys page. */
export function ActiveArchivedSwitch({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (archived: boolean) => void;
}) {
  return (
    <label
      className={`v2-class---switcher ${styles.switcher}`}
      data-switcher=""
      data-switcher-name="my-surveys-active-archived"
    >
      <span className={archived ? TEXT : ACTIVE_TEXT} data-switcher-text-left="">
        Active
      </span>
      <input
        type="checkbox"
        checked={archived}
        onChange={(event) => onChange(event.target.checked)}
        autoComplete="off"
      />
      <span className={archived ? ACTIVE_TEXT : TEXT} data-switcher-text-right="">
        Archived
      </span>
    </label>
  );
}
