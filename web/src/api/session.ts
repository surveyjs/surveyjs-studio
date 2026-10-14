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
 * The server answers even when the session already expired, so the provider's session still ends.
 * Failures stay on the page and are reported in `error`.
 */
export function useSignOut(): SignOut {
  const queryClient = useQueryClient();
  // A ref, not isPending: two clicks in the same tick both see the old render.
  const inFlight = useRef(false);
  const { mutate, isPending, error } = $api.useMutation("post", "/auth/logout", {
    onSuccess: ({ redirectUrl }) => {
      queryClient.clear();
      navigateTo(redirectUrl);
    },
    onError: () => {
      inFlight.current = false;
    },
  });
  return {
    signOut: () => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate({});
    },
    pending: isPending,
    error: error ? "Could not sign out. Please try again." : null,
  };
}
