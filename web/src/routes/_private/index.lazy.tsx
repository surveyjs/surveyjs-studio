import { useSuspenseQuery } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { configQueryOptions } from "../../api/config";

export const Route = createLazyFileRoute("/_private/")({ component: Home });

function Home() {
  const { user } = Route.useRouteContext();
  const { data: config } = useSuspenseQuery(configQueryOptions);
  return (
    <>
      <h1>My Surveys</h1>
      <p>signed in as: {user.displayName}</p>
      <p>edition: {config.edition}</p>
      <p>shell: {config.shell}</p>
    </>
  );
}
