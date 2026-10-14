import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { configQueryOptions } from "../api/config";
import { PlaceholderShell } from "../shell/PlaceholderShell";
import { applySurveyJSLicense } from "../surveyjs/license";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async ({ context }) => {
    const config = await context.queryClient.ensureQueryData(configQueryOptions);
    await applySurveyJSLicense(config.surveyjsLicenseKey ?? null);
  },
  component: () => (
    <PlaceholderShell>
      <Outlet />
    </PlaceholderShell>
  ),
  errorComponent: LoadError,
});

function LoadError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PlaceholderShell>
      <div role="alert">
        <p>
          Could not load the application configuration:{" "}
          {error instanceof Error ? error.message : String(error)}
        </p>
        <button type="button" onClick={() => void router.invalidate()}>
          Retry
        </button>
      </div>
    </PlaceholderShell>
  );
}
