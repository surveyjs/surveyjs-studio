import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { surveyQueryOptions } from "../../../../api/surveys";
import { PageHeader } from "../../../../surveyList/PageHeader";
import { surveyListSearch } from "../../../../surveyList/search";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/edit")({
  component: EditorStub,
  notFoundComponent: SurveyNotAvailable,
});

function EditorStub() {
  const { surveyId } = Route.useParams();
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const back = surveyListSearch({
    project: survey.projectId ?? "personal",
    archived: survey.archived,
  });
  return (
    <StubPage title={survey.name}>
      <p className="v2-class---paragraph">The survey editor arrives in a later version.</p>
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/" search={back}>
          Back to My Surveys
        </Link>
      </p>
    </StubPage>
  );
}

function SurveyNotAvailable() {
  return (
    <StubPage title="This survey is not available.">
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/">
          Back to My Surveys
        </Link>
      </p>
    </StubPage>
  );
}

/** The My Surveys page frame (its article and header) around the stub's text. */
function StubPage({ title, children }: { title: string; children: ReactNode }) {
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
