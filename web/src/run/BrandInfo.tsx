import { ReactElementFactory } from "survey-react-ui";
import poweredByLogo from "./poweredby.svg";

/**
 * The Form Library's brand block (survey-react-ui's `BrandInfo`, `showBrandInfo`) with the logo
 * served by the app: the library's own asks surveyjs.io for it, and the self-hosted shell makes no
 * calls to other sites (S11). The same markup and classes, so survey-core.css styles it the same; the
 * logo is surveyjs.io's `poweredby.svg`. RunSurvey adds it to the `contentBottom` container, which the
 * library renders just above where its own block goes, and only while the survey runs, as its own.
 */
export const BUNDLED_BRAND_INFO = "studio-brand-info";

function BrandInfo() {
  return (
    <div className="sv-brand-info">
      <a
        className="sv-brand-info__logo"
        href="https://surveyjs.io/?utm_source=built-in_links&utm_medium=online_survey_tool&utm_campaign=landing_page"
      >
        {/* The library's has no alt; this one names the link. */}
        <img src={poweredByLogo} alt="SurveyJS" />
      </a>
      <div className="sv-brand-info__text">
        Try and see how easy it is to{" "}
        <a href="https://surveyjs.io/create-survey?utm_source=built-in_links&utm_medium=online_survey_tool&utm_campaign=create_survey">
          create a survey
        </a>
      </div>
      <div className="sv-brand-info__terms">
        <a href="https://surveyjs.io/TermsOfUse">Terms of Use &amp; Privacy Statement</a>
      </div>
    </div>
  );
}

ReactElementFactory.Instance.registerElement(BUNDLED_BRAND_INFO, () => <BrandInfo />);
