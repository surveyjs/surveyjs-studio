import { iconHtml } from "./icons";
import { isExternal, siteUrl } from "./site";

/** The site's footer link markup: a footer link (outside links open in a new tab). */
function FooterLink({ text, url }: { text: string; url: string }) {
  const external = isExternal(url);
  return (
    <li className="v2-class---footer__link-group-item">
      <span className="v2-class---footer__link-group-item-content-wrapper">
        <div className="v2-class---footer__link-group-item-content">
          <a
            href={siteUrl(url)}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener" : undefined}
            className="v2-class---footer__link-group-item__link"
          >
            <span className="v2-class---footer__link-group-item__link-text">{text}</span>
          </a>
          {external && (
            <div
              className="v2-class---footer__link-group-item__icon-external"
              dangerouslySetInnerHTML={iconHtml("External-Link")}
            />
          )}
        </div>
      </span>
    </li>
  );
}

function FooterGroupTitle({ text }: { text: string }) {
  return (
    <li className="v2-class---footer__link-group-item v2-class---footer__link-group-item--group-title">
      <h3 className="v2-class---footer__link-group-item-group-title">{text}</h3>
    </li>
  );
}

type Links = readonly (readonly [text: string, url: string])[];

function FooterCategory({ title, links }: { title: string; links: Links }) {
  return (
    <ul className="v2-class---footer__category">
      <FooterGroupTitle text={title} />
      {links.map(([text, url]) => (
        <FooterLink key={text} text={text} url={url} />
      ))}
    </ul>
  );
}

const products: Links = [
  ["Form Library", "/form-library"],
  ["Survey Creator", "/survey-creator"],
  ["Dashboard", "/dashboard"],
  ["PDF Generator", "/pdf-generator"],
  ["WordPress Plugin", "https://wordpress.org/plugins/surveyjs/"],
];

const categories: readonly { title: string; links: Links }[] = [
  {
    title: "By Technology",
    links: [
      ["SurveyJS for React", "/try/reactjs"],
      ["SurveyJS for Angular", "/try/angular"],
      ["SurveyJS for Vue.js", "/try/vuejs"],
      ["SurveyJS for jQuery", "/try/jquery"],
      ["SurveyJS for Plain JavaScript", "/try/vanillajs"],
    ],
  },
  {
    title: "Customization",
    links: [
      [
        "Add Custom Input Fields",
        "/form-library/documentation/customize-question-types/question-customization-options",
      ],
      ["Add Custom Validation", "/form-library/documentation/data-validation"],
      [
        "Style Forms with Custom CSS",
        "/form-library/documentation/manage-default-themes-and-styles",
      ],
      [
        "White-Label the Survey Creator UI",
        "/survey-creator/documentation/survey-creator-interface-themes",
      ],
      ["Create Multilingual Forms", "/form-library/documentation/survey-localization"],
      [
        "Localize the Survey Creator UI",
        "/survey-creator/documentation/survey-localization-translate-surveys-to-different-languages",
      ],
    ],
  },
  {
    title: "Backend Integration",
    links: [
      ["Backend Integration Guide", "/documentation/backend-integration"],
      ["PHP Form Builder", "/php-form-builder"],
      ["ASP.NET Core Form Builder", "/asp-net-form-builder"],
      ["SurveyJS for Node.js", "https://github.com/surveyjs/surveyjs-nodejs"],
      ["Node.js + PostgreSQL", "https://github.com/surveyjs/surveyjs-nodejs-postgresql"],
      ["Node.js + MongoDB", "https://github.com/surveyjs/surveyjs-nodejs-mongodb"],
      ["SurveyJS for Python", "https://github.com/surveyjs/surveyjs-python-flask"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Support", "/support"],
      ["FAQ", "/faq"],
      ["Documentation", "/documentation"],
      ["Release Notes", "/stay-updated/release-notes"],
      ["Major Updates", "/stay-updated/major-updates/2024"],
      ["Pricing", "/pricing"],
      ["Licensing", "/licensing"],
    ],
  },
  {
    title: "Company",
    links: [
      ["Contact Us", "/contact-us"],
      ["Careers", "/careers"],
      [
        "Leave a Review",
        "https://reviews.capterra.com/products/new/93805969-80c2-4a34-bbf6-89e72208dc4f/b1e4407b-9c12-44ac-b0de-1b74077b0838?lang=en",
      ],
      ["Partners", "/partner-solutions"],
      ["End User License Agreement", "https://surveyjs.io/Developer-License-Agreement.pdf"],
      ["Terms of Use & Privacy Statement", "/terms-use"],
      ["Accessibility Statement", "/accessibility-statement"],
      ["Software Development Lifecycle (SDLC) Policy", "/software-development-lifecycle-policy"],
      ["Vulnerability Management Policy", "/vulnerability-management-policy"],
    ],
  },
];

const social: readonly { label: string; icon: string; url: string; newTab: boolean }[] = [
  {
    label: "Facebook",
    icon: "footer/Facebook",
    url: "https://www.facebook.com/SurveyJS/",
    newTab: true,
  },
  { label: "GitHub", icon: "footer/Github", url: "https://github.com/surveyjs", newTab: true },
  { label: "Medium", icon: "footer/Medium", url: "https://medium.com/@surveyjs", newTab: false },
  { label: "X", icon: "footer/Twitter", url: "https://twitter.com/surveyjs", newTab: false },
];

/**
 * The site's footer. The Product Hunt and SourceForge badges are left
 * out: the site loads them from those services at runtime, and My Surveys makes no such calls.
 */
export function Footer() {
  return (
    <footer className="v2-class---footer">
      <nav className="v2-class---footer__content">
        <div className="v2-class---footer__top">
          <p className="v2-class---footer__top-description">
            SurveyJS is a suite of enterprise-grade JavaScript UI components that lets you build a
            custom survey management platform{" "}
            <br className="v2-class---br v2-class---br--hide-vt v2-class---br--hide-m" />
            {/* The site's markup has white space around the line break, so words stay apart
                where the break is hidden. */}
            in any web application and retain full control of your data.
          </p>
          <div className="v2-class---footer__top-products">
            <div className="v2-class---footer__top-products-title">Products</div>
            <ul className="v2-class---footer__top-products-links">
              {products.map(([text, url]) => (
                <FooterLink key={text} text={text} url={url} />
              ))}
            </ul>
          </div>
        </div>

        <div className="v2-class---footer__categories">
          {categories.map((category) => (
            <FooterCategory key={category.title} title={category.title} links={category.links} />
          ))}
        </div>

        <div className="v2-class---footer__bottom">
          <div className="v2-class---footer__badges"></div>

          <ul className="v2-class---footer__social-links">
            <li>
              <span className="v2-class---footer__social-links-title">Follow Us</span>
            </li>
            {social.map((link) => (
              <li key={link.label}>
                <a
                  href={link.url}
                  target={link.newTab ? "_blank" : undefined}
                  rel={link.newTab ? "noopener" : undefined}
                  className="v2-class---footer__social-link"
                  aria-label={link.label}
                  dangerouslySetInnerHTML={iconHtml(link.icon)}
                />
              </li>
            ))}
          </ul>

          <p className="v2-class---footer__copyright">
            <span className="v2-class---footer__copyright-text">
              Copyright &copy; {new Date().getFullYear()} Devsoft Baltic OÜ.
            </span>{" "}
            <span className="v2-class---footer__copyright-text">All rights reserved.</span>
          </p>
        </div>
      </nav>
    </footer>
  );
}
