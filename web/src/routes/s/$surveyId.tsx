import { createFileRoute } from "@tanstack/react-router";
import { validateRunSearch } from "../../run/search";

/**
 * The public run page of a survey (`/s/$surveyId`). It sits outside `_private`: no sign-in and no
 * shell. The page itself (`$surveyId.lazy.tsx`) and the Form Library load on demand; every search
 * member except `locale` prefills an answer.
 */
export const Route = createFileRoute("/s/$surveyId")({
  validateSearch: validateRunSearch,
});
