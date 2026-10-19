import { createFileRoute } from "@tanstack/react-router";

/**
 * The public run page of a survey (`/s/$surveyId`); a placeholder until Step 8. It sits outside
 * `_private`: no sign-in, no shell and no API call.
 */
export const Route = createFileRoute("/s/$surveyId")({
  component: RunPlaceholder,
});

function RunPlaceholder() {
  return (
    <main>
      <h1>Survey</h1>
      <p>The survey run page arrives in a later version.</p>
    </main>
  );
}
