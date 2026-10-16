import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { surveyQueryOptions } from "../api/surveys";
import { PageHeader } from "./PageHeader";
import { surveyListSearch } from "./search";

/**
 * A placeholder page of one survey (editor, results, history until their steps arrive): the
 * survey's name as heading, `text`, and a way back to the survey's own list.
 */
export function SurveyPlaceholder({ surveyId, text }: { surveyId: string; text: string }) {
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const back = surveyListSearch({
    project: survey.projectId ?? "personal",
    archived: survey.archived,
  });
  return (
    <PlaceholderFrame title={survey.name}>
      <p className="v2-class---paragraph">{text}</p>
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/" search={back}>
          Back to My Surveys
        </Link>
      </p>
    </PlaceholderFrame>
  );
}

/** The `notFoundComponent` of the survey placeholder routes. */
export function SurveyNotAvailable() {
  return (
    <PlaceholderFrame title="This survey is not available.">
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/">
          Back to My Surveys
        </Link>
      </p>
    </PlaceholderFrame>
  );
}

/** The My Surveys page frame (its article and header) around a placeholder's text. */
export function PlaceholderFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="v2-class---my-surveys-page">
      <div className="v2-class---my-surveys-page__container">
        <div className="v2-class---my-surveys-page__header">
          <PageHeader title={title} />
        </div>
        {children}
      </div>
    </article>
  );
}
