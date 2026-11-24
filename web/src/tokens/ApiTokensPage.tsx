import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { FORM_PAGE_CLASS } from "../account/AccountForm";
import { ApiError } from "../api/client";
import { projectsQueryOptions } from "../api/projects";
import {
  tokensQueryOptions,
  useRevokeLegacyKey,
  useRevokeToken,
  type ApiToken,
} from "../api/tokens";
import { PageHeader } from "../surveyList/PageHeader";
import { ButtonText, DANGER, PRIMARY } from "./buttons";
import { CreateTokenDialog } from "./CreateTokenDialog";
import { maskedEnd, TokenRow } from "./TokenRow";
import styles from "./ApiTokensPage.module.css";

const PAGE = `v2-class---my-surveys-page__container ${FORM_PAGE_CLASS} ${styles.container} ${styles.page}`;

const REVOKE_TOKEN_QUESTION = "Revoke this token? Integrations that use it stop working.";
const REVOKE_KEY_QUESTION = "Revoke this key? Integrations that use it stop working.";

const rootRoute = getRouteApi("__root__");

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : fallback;
}

/** Runs an action after a confirmation, as the page's one request in flight. */
type Run = (question: string, action: () => Promise<unknown>) => void;

/** A table of tokens, with the legacy key row first in Personal. */
function TokenTable({
  tokens,
  legacyKey,
  accountUrl,
  run,
  busy,
}: {
  tokens: readonly ApiToken[];
  legacyKey?: { lastFour: string; revocable: boolean } | null;
  accountUrl: string | undefined;
  run: Run;
  busy: boolean;
}) {
  const revokeToken = useRevokeToken();
  const revokeKey = useRevokeLegacyKey();
  if (tokens.length === 0 && !legacyKey) {
    return <p className="v2-class---paragraph">No tokens yet.</p>;
  }
  return (
    <div className={styles.tableBox}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Token</th>
            <th scope="col">Created</th>
            <th scope="col">Last used</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {legacyKey && (
            <tr>
              <th scope="row">Legacy access key</th>
              <td className={styles.mono}>{maskedEnd(legacyKey.lastFour)}</td>
              <td />
              <td />
              <td>
                {legacyKey.revocable ? (
                  <button
                    type="button"
                    className={DANGER}
                    disabled={busy}
                    onClick={() => run(REVOKE_KEY_QUESTION, () => revokeKey.mutateAsync())}
                  >
                    <ButtonText size="x-small">Revoke</ButtonText>
                  </button>
                ) : (
                  accountUrl !== undefined && <a href={accountUrl}>Replace it on surveyjs.io</a>
                )}
              </td>
            </tr>
          )}
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              busy={busy}
              onRevoke={() => run(REVOKE_TOKEN_QUESTION, () => revokeToken.mutateAsync(token.id))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A project's tokens, in a section of their own. */
function ProjectSection({
  project,
  accountUrl,
  run,
  busy,
}: {
  project: { id: string; name: string };
  accountUrl: string | undefined;
  run: Run;
  busy: boolean;
}) {
  const tokens = useQuery(tokensQueryOptions(project.id));
  return (
    <section className={styles.section}>
      <h2 className={`v2-class---header__title ${styles.sectionTitle}`}>{project.name}</h2>
      {tokens.isPending && <p className="v2-class---paragraph">Loading the tokens…</p>}
      {tokens.isError && (
        <p role="alert" className={styles.error}>
          {messageOf(tokens.error, "Could not load the tokens. Please try again.")}
        </p>
      )}
      {tokens.data && (
        <TokenTable tokens={tokens.data.tokens} accountUrl={accountUrl} run={run} busy={busy} />
      )}
    </section>
  );
}

/**
 * The API tokens page (`features.apiTokens`): the user's Personal tokens and legacy access key, and
 * a section for each project they administer. Create token opens a dialog; Revoke asks first.
 */
export function ApiTokensPage() {
  const config = rootRoute.useLoaderData();
  const { data: personal } = useSuspenseQuery(tokensQueryOptions(null));
  const { data: projects } = useSuspenseQuery(projectsQueryOptions);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admined = projects.filter((project) => project.role === "admin");
  // The site's account page: the Settings link of the shell.
  const accountUrl = config.links?.["settings"];

  const run: Run = (question, action) => {
    if (busy || !window.confirm(question)) return;
    setBusy(true);
    setError(null);
    action()
      .catch((failure: unknown) =>
        setError(messageOf(failure, "Could not revoke it. Please try again.")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <article className="v2-class---my-surveys-page">
      <div className={PAGE}>
        <PageHeader title="API tokens" />
        <p className="v2-class---paragraph">
          An API token lets a script or an integration call the API as you (Personal) or as an admin
          of a project. Send it as <code>Authorization: Bearer</code>. A token is shown only when it
          is created.
        </p>
        <div className={styles.actions}>
          <button type="button" className={PRIMARY} onClick={() => setCreating(true)}>
            <ButtonText>Create token</ButtonText>
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <section className={styles.section}>
          <h2 className={`v2-class---header__title ${styles.sectionTitle}`}>Personal</h2>
          <TokenTable
            tokens={personal.tokens}
            legacyKey={personal.legacyKey}
            accountUrl={accountUrl}
            run={run}
            busy={busy}
          />
        </section>

        {admined.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            accountUrl={accountUrl}
            run={run}
            busy={busy}
          />
        ))}
      </div>
      {creating && <CreateTokenDialog scopes={admined} onClose={() => setCreating(false)} />}
    </article>
  );
}
