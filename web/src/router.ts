import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { ApiError } from "./api/client";
import { currentUserQueryOptions } from "./api/session";
import { routeTree } from "./routeTree.gen";

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    history,
  });
  // Inline, so the bundler removes this from the normal build.
  if (import.meta.env.MODE === "sandbox") {
    // The sandbox's session is a cookie that another tab's Reset (or Sign Out) can clear, so any
    // request can answer 401 mid-visit: the tab goes to the account picker, and back to this page
    // after. A navigation that is still loading is left alone: the private guard redirects itself.
    const onEvent = (event: {
      type: string;
      action?: { type: string; error?: unknown };
      query?: { queryKey: readonly unknown[] };
    }) => {
      if (event.type !== "updated" || event.action?.type !== "error") return;
      const error = event.action.error;
      // The current user is asked on purpose where a 401 is expected (an anonymous Page not found);
      // the private guard handles it on private routes.
      if (event.query?.queryKey[0] === currentUserQueryOptions.queryKey[0]) return;
      if (!(error instanceof ApiError) || error.problem.status !== 401) return;
      const { location, status } = router.state;
      if (status === "pending" || location.pathname === "/sign-in") return;
      void router.navigate({ to: "/sign-in", search: { returnTo: location.href } });
    };
    queryClient.getQueryCache().subscribe(onEvent);
    queryClient.getMutationCache().subscribe(onEvent);
  }
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
