import { useId, useRef, type FormEvent, type ReactNode } from "react";
import styles from "./AccountForm.module.css";

/** A labelled text box of an account form, in the site's text-edit style. */
export function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: "email" | "password" | "text";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className="v2-class---text-edit">
        <input
          id={id}
          className="v2-class---text-edit__input"
          type={type}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * The form of a sign-in, set-password or change-password page: the fields, an error under them and
 * the submit button, which is disabled while the request runs. `onSubmit` runs once per submit,
 * even for two submits in the same tick.
 */
export function AccountForm({
  submitText,
  pending,
  error,
  onSubmit,
  children,
}: {
  submitText: string;
  pending: boolean;
  error: string | null;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
}) {
  // A ref, not `pending`: two submits in the same tick both see the old render.
  const inFlight = useRef(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    void onSubmit().finally(() => {
      inFlight.current = false;
    });
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {children}
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <button
        type="submit"
        className="v2-class---button v2-class---button--brand-primary v2-class---button--medium"
        disabled={pending}
      >
        <span className="v2-class---button__text v2-class---button__text--medium">
          {submitText}
        </span>
      </button>
    </form>
  );
}
