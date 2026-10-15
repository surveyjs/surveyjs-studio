import { queryOptions } from "@tanstack/react-query";
import { client, toApiError } from "./client";

export const configQueryOptions = queryOptions({
  queryKey: ["config"],
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }) => {
    const { data, error, response } = await client.GET("/config", { signal });
    if (!response.ok || data === undefined) throw toApiError(error, response);
    return data;
  },
});
