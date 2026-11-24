import type { ApiToken } from "../api/tokens";
import { ButtonText, DANGER } from "./buttons";
import styles from "./ApiTokensPage.module.css";

const dateTime = (iso: string | null) =>
  iso === null
    ? "Never"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );

/** The end of a token's value (the value itself is never kept), as the list shows it. */
export const maskedEnd = (lastFour: string) => `…${lastFour}`;

/** One token: its name, the end of its value, who made it and when, when it was last used, Revoke. */
export function TokenRow({
  token,
  busy,
  onRevoke,
}: {
  token: ApiToken;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <tr>
      <th scope="row">{token.name}</th>
      <td className={styles.mono}>{maskedEnd(token.lastFour)}</td>
      <td>
        {token.createdBy.displayName}, {dateTime(token.createdAt)}
      </td>
      <td>{dateTime(token.lastUsedAt)}</td>
      <td>
        <button
          type="button"
          className={DANGER}
          disabled={busy}
          aria-label={`Revoke ${token.name}`}
          onClick={onRevoke}
        >
          <ButtonText size="x-small">Revoke</ButtonText>
        </button>
      </td>
    </tr>
  );
}
