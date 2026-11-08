import { createFileRoute } from "@tanstack/react-router";
import { searchText } from "../account/returnTo";

/**
 * Where the server sends a refused OAuth2 sign-in. It sits outside `_private` and, with the
 * trailing underscore in the file name, outside `/sign-in` (which has its own guard).
 */
export const Route = createFileRoute("/sign-in_/refused")({
  validateSearch: (search: Record<string, unknown>): { reason?: string; provider?: string } => ({
    reason: searchText(search["reason"]),
    provider: searchText(search["provider"]),
  }),
});
