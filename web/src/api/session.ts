import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { navigateTo } from "../navigation";
import { $api, client, toApiError } from "./client";

export const currentUserQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: async ({ signal }) => {
    const { data, error, response } = await client.GET("/me", { signal });
    if (!response.ok || data === undefined) throw toApiError(error, response);
    return data;
  },
});

export interface SignOut {
  signOut: () => void;
  pending: boolean;
  /** A message to show when signing out failed; null otherwise. */
  error: string | null;
}

/**
 * Signs out on the server, forgets everything cached for the user, then leaves for the provider's URL.
 * A 401 means the session is already gone, so it counts as signed out. Other failures stay on the
 * page and are reported in `error`.
 */
export function useSignOut(): SignOut {
  const queryClient = useQueryClient();
  // A ref, not isPending: two clicks in the same tick both see the old render.
  const inFlight = useRef(false);
  const leave = (url: string) => {
    queryClient.clear();
    navigateTo(url);
  };
  const { mutate, isPending, error } = $api.useMutation("post", "/auth/logout", {
    onSuccess: ({ redirectUrl }) => leave(redirectUrl),
    onError: (failure) => {
      inFlight.current = false;
      if ((failure as { status?: number }).status === 401) leave("/");
    },
  });
  const unauthorised = (error as { status?: number } | null)?.status === 401;
  return {
    signOut: () => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate({});
    },
    pending: isPending,
    error: error && !unauthorised ? "Could not sign out. Please try again." : null,
  };
}
