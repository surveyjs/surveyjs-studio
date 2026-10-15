import { useSuspenseQuery } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { configQueryOptions } from "../api/config";

export const Route = createLazyFileRoute("/")({ component: Home });

function Home() {
  const { data: config } = useSuspenseQuery(configQueryOptions);
  return (
    <>
      <h1>My Surveys</h1>
      <p>edition: {config.edition}</p>
      <p>shell: {config.shell}</p>
    </>
  );
}
