// The respondent's client id for "Limit to one response" (S18). The browser keeps one random id in
// localStorage (the browser id), which is never sent. Each survey gets its own id derived from it,
// so the server can tell a second response of the same browser to that survey, while the authors of
// two surveys, who can read the ids of their responses, cannot match a respondent across them.
// Sent only when the survey limits responses.

export const CLIENT_ID_KEY = "my-surveys.client-id";

/** The contract's `ClientId`: 1–256 characters, no `/`, `\`, `#`, `?` or control characters. */
// eslint-disable-next-line no-control-regex -- the contract's pattern names control characters
const CLIENT_ID = /^[^/\\#?\u0000-\u001F\u007F-\u009F]{1,256}$/;

/**
 * The id a survey sees: the lower-case hex SHA-256 of `{browser id}:{survey id in lower case}`,
 * 64 characters that fit the contract's `ClientId`. The same browser and survey always give the
 * same id; the browser id cannot be read back from it.
 */
export async function perSurveyClientId(
  browserId: string,
  surveyId: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string> {
  const text = new TextEncoder().encode(`${browserId}:${surveyId.toLowerCase()}`);
  const digest = new Uint8Array(await subtle.digest("SHA-256", text));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A random version 4 UUID. `crypto.randomUUID` exists only in a secure context (HTTPS or
 * localhost); `getRandomValues` exists everywhere, so the page also works over plain HTTP.
 */
export function randomId(
  source: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = crypto,
): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ClientIds {
  /** This survey's id from the browser id already stored, or null (none, not valid, no storage or no digest). */
  stored(): Promise<string | null>;
  /**
   * This survey's id, making and storing a browser id first when there is none. The id stays the
   * same for this page load anyway: when the browser id cannot be stored it is derived from one
   * kept in memory, and without Web Crypto digests (`crypto.subtle`, missing outside a secure
   * context) it is a random id for this page load and the stored browser id is left alone.
   */
  ensure(): Promise<string>;
}

export function createClientIds(
  surveyId: string,
  {
    storage = () => window.localStorage,
    newId = () => randomId(),
    subtle = () => globalThis.crypto?.subtle as SubtleCrypto | undefined,
  }: {
    storage?: () => Storage;
    newId?: () => string;
    subtle?: () => SubtleCrypto | undefined;
  } = {},
): ClientIds {
  /** The browser id made on this page load, when storage did not keep it. */
  let created: string | null = null;
  /** The id sent without digests: random, for this page load only. */
  let pageLoadId: string | null = null;

  const storedBrowserId = (): string | null => {
    try {
      const value = storage().getItem(CLIENT_ID_KEY);
      return value !== null && CLIENT_ID.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  const forPageLoad = (): string => (pageLoadId ??= newId());

  return {
    async stored() {
      const digests = subtle();
      const browserId = storedBrowserId();
      if (digests === undefined || browserId === null) return null;
      try {
        return await perSurveyClientId(browserId, surveyId, digests);
      } catch {
        return null;
      }
    },
    async ensure() {
      const digests = subtle();
      if (digests === undefined) return forPageLoad();
      // Made before the first await, so two calls at once agree on one browser id.
      let browserId = storedBrowserId() ?? created;
      if (browserId === null) {
        browserId = newId();
        created = browserId;
        try {
          storage().setItem(CLIENT_ID_KEY, browserId);
        } catch {
          // No storage (private mode, blocked): the id lasts for this page load.
        }
      }
      try {
        return await perSurveyClientId(browserId, surveyId, digests);
      } catch {
        return forPageLoad();
      }
    },
  };
}
