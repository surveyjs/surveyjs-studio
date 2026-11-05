import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { configQueryOptions } from "../api/config";
import { currentUserQueryOptions } from "../api/session";
import { AnonymousShell } from "../shell/PlainShell";
import { PrivateShell } from "../shell/PrivateShell";
import { SELF_HOSTED_SHELL, renderAnonymousPage } from "../shell/registry";
import { ReadOnlyBanner } from "../shell/ReadOnlyBanner";
import { PageHeader } from "../surveyList/PageHeader";
import { applySurveyJSLicense } from "../surveyjs/license";
import { LazySandboxBanner } from "../sandboxLazy";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async ({ context }) => {
    const config = await context.queryClient.ensureQueryData(configQueryOptions);
    // Fire and forget: survey-core is a large lazy chunk, and nothing on the page needs the
    // licence yet, so neither wait for it nor let a failed chunk load break the page.
    // (Step 4 moves this into the SurveyJS route loaders.)
    applySurveyJSLicense(config.surveyjsLicenseKey ?? null).catch((error: unknown) => {
      console.warn("Could not apply the SurveyJS licence key", error);
    });
    return config;
  },
  component: RootLayout,
  errorComponent: LoadError,
  notFoundComponent: PageNotFound,
});

function RootLayout() {
  const config = Route.useLoaderData();
  // The run page is what a respondent sees: the demo banner is a thin strip there.
  const onRunPage = useRouterState({
    select: (state) => state.location.pathname.startsWith("/s/"),
  });
  return (
    <>
      {config.readOnly && <ReadOnlyBanner />}
      {/* Inline, so the bundler removes the sandbox banner from the normal build. */}
      {import.meta.env.MODE === "sandbox" && <LazySandboxBanner compact={onRunPage} />}
      <Outlet />
    </>
  );
}

/**
 * An address the app does not know, surveyjs.io's old ones included (they are never redirected
 * here, R22). In the self-hosted shell the page sits in its frame (the signed-in shell for a user,
 * else the frame of a visitor who is not signed in); elsewhere the root renders outside the shell,
 * so the page has none and uses the site's header, paragraph and small primary button classes.
 */
function PageNotFound() {
  const config = Route.useLoaderData();
  const framed = config.shell === SELF_HOSTED_SHELL;
  // Only the self-hosted shell needs to know who is asking; the others never call /me here.
  const me = useQuery({ ...currentUserQueryOptions, enabled: framed, retry: false });
  const content = <NotFoundContent main={!framed} />;
  if (!framed) return content;
  if (me.isPending) return null;
  return me.data ? (
    <PrivateShell config={config} user={me.data}>
      {content}
    </PrivateShell>
  ) : (
    renderAnonymousPage(config, content)
  );
}

function NotFoundContent({ main }: { main: boolean }) {
  const Wrapper = main ? "main" : "div";
  return (
    <Wrapper>
      <PageHeader title="Page not found" />
      <p className="v2-class---paragraph">This page doesn't exist or has moved.</p>
      <Link
        to="/"
        className="v2-class---button v2-class---button--brand-primary v2-class---button--small"
      >
        <span className="v2-class---button__text v2-class---button__text--small">
          Go to My Surveys
        </span>
      </Link>
    </Wrapper>
  );
}

function LoadError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <AnonymousShell>
      <div role="alert">
        <p>
          Could not load the application: {error instanceof Error ? error.message : String(error)}
        </p>
        <button type="button" onClick={() => void router.invalidate()}>
          Retry
        </button>
      </div>
    </AnonymousShell>
  );
}
