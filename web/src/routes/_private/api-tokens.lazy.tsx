import { createLazyFileRoute } from "@tanstack/react-router";
import { ApiTokensPage } from "../../tokens/ApiTokensPage";

export const Route = createLazyFileRoute("/_private/api-tokens")({ component: ApiTokensPage });
