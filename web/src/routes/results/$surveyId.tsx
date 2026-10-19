import { createFileRoute } from "@tanstack/react-router";

/**
 * The public results page of a survey (`/results/$surveyId`). It sits outside `_private`: no
 * sign-in and no shell; the page and the Dashboard load on demand.
 */
export const Route = createFileRoute("/results/$surveyId")({});
