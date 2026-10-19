import { useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * The inline rename of a survey name, shared by the list row and the editor's footer bar: whether
 * the editor is open, and an optimistic rename. Saving closes the editor at once (focus back on the
 * pencil) and shows the new name until `send` settles: on success the cache holds the new name, on
 * failure the old one shows again. A blank or unchanged name sends nothing. `send` must not reject.
 */
export function useRenameEditor(currentName: string, send: (name: string) => Promise<unknown>) {
  const [editing, setEditing] = useState(false);
  // Blur can follow Enter and the button presses: the first of them ends the edit, the rest do
  // nothing.
  const open = useRef(false);
  // The name sent by a rename that has not been answered yet.
  const [pendingName, setPendingName] = useState<string | null>(null);
  const renames = useRef(0);
  const pencilRef = useRef<HTMLAnchorElement>(null);
  const name = pendingName ?? currentName;

  /** Opens the editor; false when it is open already. */
  const startEdit = () => {
    if (open.current) return false;
    open.current = true;
    setEditing(true);
    return true;
  };

  /** Closes the editor without saving; false when it was not open. */
  const cancel = (refocus = true) => {
    if (!open.current) return false;
    open.current = false;
    flushSync(() => setEditing(false));
    if (refocus) pencilRef.current?.focus();
    return true;
  };

  /** Closes the editor and renames to `value` unless it is blank or unchanged. */
  const save = (value: string, refocus = true) => {
    if (!cancel(refocus)) return;
    if (value.trim() === "" || value === name) return;
    const rename = ++renames.current;
    setPendingName(value);
    void send(value).then(() => {
      if (renames.current === rename) setPendingName(null);
    });
  };

  return { name, editing, pencilRef, startEdit, cancel, save };
}
