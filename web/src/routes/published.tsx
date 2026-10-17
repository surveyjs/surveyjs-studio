import { createFileRoute, redirect } from "@tanstack/react-router";
import { NotAvailable } from "../run/NotAvailable";
import { validateRunSearch } from "../run/search";

/** The survey id of surveyjs.io's run link (`/published?id=`): text, or a number the parser made. */
function surveyIdOf(id: unknown): string | undefined {
  const text = typeof id === "number" && Number.isFinite(id) ? String(id) : id;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * surveyjs.io's run page address, `/published?id={surveyId}`: replaced by `/s/{surveyId}` with
 * every other search member kept (the locale and prefilled answers). Without an id the survey is
 * not available.
 */
export const Route = createFileRoute("/published")({
  validateSearch: validateRunSearch,
  beforeLoad: ({ search }) => {
    const surveyId = surveyIdOf(search.id);
    if (surveyId === undefined) return;
    const rest = Object.fromEntries(Object.entries(search).filter(([name]) => name !== "id"));
    throw redirect({ to: "/s/$surveyId", params: { surveyId }, search: rest, replace: true });
  },
  component: NotAvailable,
});
