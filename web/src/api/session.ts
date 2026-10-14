import { queryOptions, useQueryClient } from "@tanstack/react-query";
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

/** Signs out on the server, forgets everything cached for the user, then leaves for the provider's URL. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  const { mutate } = $api.useMutation("post", "/auth/logout", {
    onSuccess: ({ redirectUrl }) => {
      queryClient.clear();
      navigateTo(redirectUrl);
    },
  });
  return () => mutate({});
}
