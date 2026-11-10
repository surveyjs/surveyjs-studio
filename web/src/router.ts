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
  // A session can end while a signed-in page is open: signed out in another tab, expired, or
  // disabled or reset by an instance admin (in the sandbox, another tab's Reset). Any request of
  // the page then answers 401, so the page goes to sign-in, and back to this page after. The
  // private guard does it: it asks for the current user again and goes where it always goes (the
  // app's sign-in page, the server's login for surveyjs.io alone, the forced password change).
  // A navigation that is still loading is left alone: the guard redirects itself.
  const onEvent = (event: { type: string; action?: { type: string; error?: unknown } }) => {
    if (event.type !== "updated" || event.action?.type !== "error") return;
    const error = event.action.error;
    if (!(error instanceof ApiError) || error.problem.status !== 401) return;
    const { status, matches } = router.state;
    if (status === "pending") return;
    // A public page (the run page, public results, Page not found) and the sign-in pages expect a
    // 401: a visitor without a session, a wrong password. Only a private page has lost its session.
    if (!matches.some((match) => match.routeId === "/_private")) return;
    // The guard must ask again, not trust the cached user.
    queryClient.removeQueries({ queryKey: currentUserQueryOptions.queryKey });
    void router.invalidate();
  };
  queryClient.getQueryCache().subscribe(onEvent);
  queryClient.getMutationCache().subscribe(onEvent);
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
