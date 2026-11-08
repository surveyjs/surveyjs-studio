import { useId, useState, type ReactNode } from "react";
import { iconHtml } from "./icons";
import { siteUrl } from "./site";
import { SiteButton } from "./SiteButton";
import { readStored, writeStored } from "./storage";
import styles from "./SurveyjsSiteShell.module.css";

/**
 * The site's consent flag (from its cookie banner): once set, the banner is not shown
 * again. The site stores `true` for both "Accept All" and "Confirm My Choices".
 */
export const COOKIE_CONSENT_KEY = "isInformedAboutCookieAndPolicies";

type View = "banner" | "settings" | "hidden";

/**
 * The cookie banner and its "Cookie Settings" popup. Unlike the site, accepting updates no
 * analytics consent: My Surveys loads no analytics or advertising scripts.
 */
export function CookieBanner() {
  const [view, setView] = useState<View>(() =>
    readStored(COOKIE_CONSENT_KEY) ? "hidden" : "banner",
  );
  const titleId = useId();
  const settingsTitleId = useId();
  const accept = () => {
    writeStored(COOKIE_CONSENT_KEY, "true");
    setView("hidden");
  };

  return (
    <>
      {view === "banner" && (
        <div
          className="v2-class---banner v2-class---banner--cookies"
          style={{ display: "block" }}
          role="region"
          aria-labelledby={titleId}
        >
          <div className="v2-class---banner__content v2-class---banner__content--cookies-info">
            <h3 className="v2-class---banner__title" id={titleId}>
              Your cookie settings
            </h3>

            <p className="v2-class---banner__paragraph">
              We use cookies to make your browsing experience more convenient and personal. Some
              cookies are essential, while others help us analyse traffic. Your personal data and
              cookies may be used for ad personalization. By clicking “Accept All”, you consent to
              the use of all cookies as described in our{" "}
              <a
                className="v2-class---paragraph-link v2-class---paragraph-link--small"
                href={siteUrl("/terms-use")}
              >
                Terms of Use and Privacy Statement
              </a>
              . You can manage your preferences in “Cookie settings.”
            </p>

            <div className="v2-class---banner-footer-actions">
              <SiteButton
                text="Accept All"
                style="Brand"
                mode="Primary"
                size="Medium-Adaptive"
                onClick={accept}
              />
              <div className="v2-class---link">
                <a
                  href="#"
                  role="button"
                  className="v2-class---paragraph-link v2-class---link__text"
                  onClick={(event) => {
                    event.preventDefault();
                    setView("settings");
                  }}
                >
                  Cookie Settings
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "settings" && (
        <div
          className="v2-class---popup v2-class---popup--cookies"
          style={{ display: "block" }}
          onClick={() => setView("banner")}
        >
          <div
            className="v2-class---popup-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby={settingsTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="v2-class---popup__title" id={settingsTitleId}>
              Privacy Overview
            </h3>
            <button
              type="button"
              className={`v2-class---popup__close ${styles.closeButton}`}
              title="Close"
              aria-label="Close"
              onClick={() => setView("banner")}
            />
            <div className="v2-class---popup__content v2-class---popup__content--cookies-settings">
              <p className="v2-class---paragraph">
                This website uses cookies to improve the efficiency and relevance of the site for
                you while you navigate through it. Out of the cookies, the cookies that are
                categorized as ‘Functional’ are stored on your browser and are essential for the
                working of basic functionalities.
              </p>

              <div className="v2-class---popup__cookies-settings-list">
                <CookieCategory question="Functional" checked disabled>
                  These are first party cookies that must be set to allow us to deliver the site to
                  you and to provide specific services that you request from us. They are usually
                  only set in response to actions made by you which amount to a request for
                  services, such as setting your privacy preferences, logging in or filling in
                  forms. The services offered by our site that require cookies in order to function
                  include: account log-in, billing and shopping basket features, code examples and
                  product demos, license manager, and the all-in-one demo tool.
                </CookieCategory>
                <CookieCategory question="Performance" checked disabled>
                  These cookies allow us to count visits and traffic sources so we can measure and
                  improve the performance of our site. They help us to know which pages are the most
                  and least popular and see how visitors move around the site. All information these
                  cookies collect is aggregated and therefore anonymous.
                </CookieCategory>
                <CookieCategory question="Targeting">
                  These cookies may be set through our site by our advertising partners to show you
                  relevant adverts.
                  <br className="v2-class---br" />
                  <br className="v2-class---br" />
                  <Provider name="Google" url="https://business.safety.google/privacy/" />
                  <Provider name="Reddit" url="https://www.reddit.com/policies/privacy-policy" />
                  <Provider name="X Corp." url="https://x.com/en/privacy" />
                </CookieCategory>
              </div>
            </div>
            <div className="v2-class---popup__footer">
              <SiteButton
                text="Confirm My Choices"
                style="Brand"
                mode="Primary"
                size="Medium-Adaptive"
                onClick={accept}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Provider({ name, url }: { name: string; url: string }) {
  return (
    <>
      {name}
      <br className="v2-class---br" />
      <a className="v2-class---paragraph-link v2-class---paragraph-link--small" href={url}>
        Learn more about this provider
      </a>
      <br className="v2-class---br" />
      <br className="v2-class---br" />
    </>
  );
}

/**
 * The site's FAQ question markup with a checkbox. As on the site, the choice is not stored:
 * both buttons record the same consent.
 */
function CookieCategory(props: {
  question: string;
  checked?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="v2-class---faq-question-wrapper">
      <label className="v2-class---faq-question__checkbox v2-class---checkbox">
        <input
          className="v2-class---checkbox__input"
          type="checkbox"
          defaultChecked={props.checked}
          disabled={props.disabled}
          aria-label={props.question}
        />
        <span
          className="v2-class---checkbox__checkmark"
          dangerouslySetInnerHTML={iconHtml("forms/Check-Mark")}
        />
      </label>
      <details className="v2-class---faq-question">
        <summary className="v2-class---faq-question__question">
          <div className="v2-class---faq-question__question-content">
            <h3 className="v2-class---faq-question__question-text">{props.question}</h3>
            <div className="v2-class---faq-question__expand-collapse-button">
              <div
                className="v2-class---expand-collapse-button"
                dangerouslySetInnerHTML={iconHtml("Expand-Collapse-Arrow")}
              />
            </div>
          </div>
        </summary>
        <div className="v2-class---faq-question__answer">{props.children}</div>
      </details>
    </div>
  );
}
