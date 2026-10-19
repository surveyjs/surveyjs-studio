// The respondent's client id for "Limit to one response" (S18): one random id per browser, kept in
// localStorage, so the server can tell a second response of the same browser. Sent only when the
// survey limits responses.

export const CLIENT_ID_KEY = "my-surveys.client-id";

/** The contract's `ClientId`: 1–256 characters, no `/`, `\`, `#`, `?` or control characters. */
// eslint-disable-next-line no-control-regex -- the contract's pattern names control characters
const CLIENT_ID = /^[^/\\#?\u0000-\u001F\u007F-\u009F]{1,256}$/;

export interface ClientIds {
  /** The id this browser already has, or null (none, not valid, or storage unavailable). */
  stored(): string | null;
  /** The stored id, else a new one: stored when storage allows, kept for this page load anyway. */
  ensure(): string;
}

export function createClientIds(
  storage: () => Storage = () => window.localStorage,
  newId: () => string = () => crypto.randomUUID(),
): ClientIds {
  let created: string | null = null;
  const stored = (): string | null => {
    try {
      const value = storage().getItem(CLIENT_ID_KEY);
      return value !== null && CLIENT_ID.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    stored,
    ensure() {
      const existing = stored() ?? created;
      if (existing !== null) return existing;
      const id = newId();
      created = id;
      try {
        storage().setItem(CLIENT_ID_KEY, id);
      } catch {
        // No storage (private mode, blocked): the id lasts for this page load.
      }
      return id;
    },
  };
}
