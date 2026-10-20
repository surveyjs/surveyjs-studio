import type { QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { configQueryOptions } from "../api/config";
import { AnonymousShell } from "../shell/PlainShell";
import { PageHeader } from "../surveyList/PageHeader";
import { applySurveyJSLicense } from "../surveyjs/license";

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
  component: Outlet,
  errorComponent: LoadError,
  notFoundComponent: PageNotFound,
});

/**
 * An address the app does not know, surveyjs.io's old ones included (they are never redirected
 * here, R22). The root renders outside the shell, so the page has none; it uses the site's header,
 * paragraph and small primary button classes.
 */
function PageNotFound() {
  return (
    <main>
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
    </main>
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
