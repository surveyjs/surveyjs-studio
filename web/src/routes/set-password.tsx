import { createFileRoute } from "@tanstack/react-router";
import { searchText } from "../account/returnTo";

/**
 * The page of a one-time link (`/set-password?setup=` for the first admin, `?token=` for an
 * account). It sits outside `_private`: the visitor is not signed in.
 */
export const Route = createFileRoute("/set-password")({
  validateSearch: (search: Record<string, unknown>): { setup?: string; token?: string } => ({
    setup: searchText(search["setup"]),
    token: searchText(search["token"]),
  }),
});
