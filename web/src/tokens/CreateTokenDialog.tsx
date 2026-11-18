import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useCreateToken } from "../api/tokens";
import { ButtonText, PRIMARY, SECONDARY } from "./buttons";
import styles from "./ApiTokensPage.module.css";

/** A project the user administers, as the Scope list offers it. */
export interface ScopeOption {
  readonly id: string;
  readonly name: string;
}

const PERSONAL = "";

/**
 * The Create token dialog: a Name and a Scope (Personal, or a project the user administers). After
 * the token is made the dialog shows its value, once, with a copy button. The value lives in this
 * component's state only; Done (or Escape) closes the dialog, which unmounts it and drops the value.
 */
export function CreateTokenDialog({
  scopes,
  onClose,
}: {
  scopes: readonly ScopeOption[];
  onClose: () => void;
}) {
  const create = useCreateToken();
  const titleId = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState(PERSONAL);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "by-hand">("no");
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    setValue(null);
    create.reset();
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    setError(null);
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        projectId: scope === PERSONAL ? null : scope,
      });
      setValue(created.value);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? (failure.problem.detail ?? failure.problem.title)
          : "Could not create the token. Please try again.",
      );
    }
  };

  const copy = async () => {
    if (value === null) return;
    try {
      // Undefined outside a secure context: the call throws, as a refused write rejects.
      await navigator.clipboard.writeText(value);
      setCopied("yes");
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopied("by-hand");
    }
  };

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <h2 id={titleId} className={`v2-class---header__title ${styles.dialogTitle}`}>
          Create token
        </h2>
        {value === null ? (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${titleId}-name`}>
                Name
              </label>
              <div className="v2-class---text-edit">
                <input
                  id={`${titleId}-name`}
                  className="v2-class---text-edit__input"
                  type="text"
                  required
                  maxLength={100}
                  autoComplete="off"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${titleId}-scope`}>
                Scope
              </label>
              <select
                id={`${titleId}-scope`}
                className={styles.select}
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value={PERSONAL}>Personal</option>
                {scopes.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.buttons}>
              <button type="submit" className={PRIMARY} disabled={create.isPending}>
                <ButtonText>Create</ButtonText>
              </button>
              <button type="button" className={SECONDARY} onClick={close}>
                <ButtonText>Cancel</ButtonText>
              </button>
            </div>
          </form>
        ) : (
          <>
            <p role="status" className="v2-class---paragraph">
              Copy this token now. You won&apos;t see it again.
            </p>
            <div className={styles.valueRow}>
              <input
                ref={input}
                className="v2-class---text-edit__input"
                readOnly
                aria-label="Token"
                value={value}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className={SECONDARY} onClick={() => void copy()}>
                <ButtonText>Copy token</ButtonText>
              </button>
            </div>
            {copied === "yes" && <p className="v2-class---paragraph">Copied.</p>}
            {copied === "by-hand" && (
              <p className="v2-class---paragraph">
                This browser does not let the page copy the token here (the page is not on HTTPS).
                The token is selected: press Ctrl+C, or ⌘C on a Mac, to copy it.
              </p>
            )}
            <div className={styles.buttons}>
              <button type="button" className={PRIMARY} onClick={close}>
                <ButtonText>Done</ButtonText>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
