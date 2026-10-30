import { useEffect, useState } from "react";
import { Model, type ITheme } from "survey-core";
import "survey-core/survey-core.css";
import { Survey } from "survey-react-ui";
import { submitResponse, uploadResponseFile } from "../api/public";
import type { ClientIds } from "./clientId";
import { completedBeforeCookie, runCookieName } from "./cookie";
import { forRunPage } from "./definition";
import { guardLeaving } from "./leaveGuard";
import type { RunSurveyData } from "./load";
import { createResponseUploadHandler } from "./responseUploads";
import { localeOf, needsLocales, prefillValues, type RunSearch } from "./search";
import { createSubmitHandler } from "./submit";

export interface RunSurveyProps {
  readonly surveyId: string;
  readonly data: RunSurveyData;
  /** `completed`: this browser has completed the survey, so the library shows its completed-before content. */
  readonly kind: "running" | "completed";
  readonly search: RunSearch;
  readonly clientIds: ClientIds;
  /** The configured limit per respondent file (`limits.maxFileBytes`). */
  readonly maxFileBytes: number;
  /** The library's brand block under the survey (`showBrandInfo`); off when the shell has its own footer. */
  readonly brandInfo: boolean;
}

function createModel({
  surveyId,
  data,
  kind,
  search,
  clientIds,
  maxFileBytes,
  brandInfo,
}: RunSurveyProps) {
  const { survey, limitCookie } = data;
  // The library writes and reads its cookie under this name, a token without attributes.
  const cookieName = limitCookie === null ? null : runCookieName(limitCookie, surveyId);
  // The library reads the cookie while it loads the definition (S18).
  if (kind === "completed" && cookieName !== null) {
    const cookie = completedBeforeCookie(cookieName);
    if (cookie !== null) document.cookie = cookie;
  }
  const model = new Model(forRunPage(survey.definition, cookieName));
  if (Object.keys(survey.theme).length > 0) model.applyTheme(survey.theme as ITheme);
  // As surveyjs.io's run page: no jump to the first question, and the library's brand footer.
  model.focusFirstQuestionAutomatic = false;
  model.showBrandInfo = brandInfo;
  const locale = localeOf(search);
  if (locale !== undefined) model.locale = locale;
  for (const [name, value] of prefillValues(search)) model.setValue(name, value);
  model.onComplete.add(
    createSubmitHandler({
      submit: (body, key) => submitResponse(surveyId, body, key),
      // The client id is sent only when the survey limits responses.
      clientId: () => (limitCookie === null ? Promise.resolve(undefined) : clientIds.ensure()),
      guardLeaving,
    }),
  );
  const upload = createResponseUploadHandler({
    upload: (file) => uploadResponseFile(surveyId, file),
    maxFileBytes,
  });
  model.onUploadFiles.add((_, options) => upload(options));
  return model;
}

/**
 * The Form Library running one published survey. This is the only module that imports the
 * library and its styles (the `survey-form` chunk). The model is built once per mount, after the
 * library's translations when the URL asks for a language other than English.
 */
export function RunSurvey(props: RunSurveyProps) {
  const { surveyId, data, kind, search, clientIds, maxFileBytes, brandInfo } = props;
  const [model, setModel] = useState<Model | null>(null);

  useEffect(() => {
    let created: Model | null = null;
    let closed = false;
    const build = () => {
      if (closed) return;
      created = createModel({ surveyId, data, kind, search, clientIds, maxFileBytes, brandInfo });
      setModel(created);
    };
    if (needsLocales(localeOf(search))) {
      import("./surveyLocales").then(build, (error: unknown) => {
        // Without the translations the survey still runs, with the library's English texts.
        console.warn("Could not load the survey translations", error);
        build();
      });
    } else {
      build();
    }
    return () => {
      closed = true;
      created?.dispose();
    };
  }, [surveyId, data, kind, search, clientIds, maxFileBytes, brandInfo]);

  if (model === null) return <p role="status">Loading the survey…</p>;
  return <Survey model={model} />;
}
