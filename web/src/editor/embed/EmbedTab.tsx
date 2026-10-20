// The "Embed Survey" and "Embed Creator" tabs of surveyjs.io's editor (Scripts/Models/embed-tab.tsx):
// their names, titles, icons, texts and class names are the site's (D14); the component is our own.
// The settings are in the Creator's sidebar, as on the site. Part of the Creator chunk.
import { createElement, useEffect, useState } from "react";
import { Base, Version } from "survey-core";
import { propertyGridCss, type ICreatorPlugin } from "survey-creator-core";
import type { SurveyCreator } from "survey-creator-react";
import { ReactElementFactory, SvgIcon } from "survey-react-ui";
import "../../shell/surveyjs-site/assets/site/Content/Styles/pages/create-free-survey/embedded-tab.scss";
import {
  creatorEmbedCode,
  DEFAULT_PLATFORM,
  EMBED_PLATFORMS,
  gettingStartedUrl,
  surveyEmbedCode,
  type CodeBlock,
  type EmbedPlatform,
} from "./embedCode";
import styles from "./EmbedTab.module.css";

type Product = "survey" | "creator";

/** The sidebar's settings survey (Scripts/Models/embed-tab.tsx): platform, display method, service. */
function createSettingsSurvey(creator: SurveyCreator, product: Product, canLoad: boolean) {
  const creatorTab = product === "creator";
  const survey = creator.createSurvey(
    {
      showNavigationButtons: "none",
      showPageTitles: false,
      focusFirstQuestionAutomatic: false,
      showQuestionNumbers: "off",
      elements: [
        {
          type: "panel",
          name: "root",
          elements: [
            {
              type: "dropdown",
              name: "platform",
              defaultValue: DEFAULT_PLATFORM,
              title: "Select Platform",
              allowClear: false,
              descriptionLocation: "hidden",
              inputFieldComponent: "dropdown-custom-input",
              searchEnabled: false,
              choices: EMBED_PLATFORMS.map((choice) => ({
                value: choice.value,
                text: choice.text,
              })),
            },
            {
              type: "dropdown",
              name: "displayMethod",
              searchEnabled: false,
              defaultValue: "onPage",
              title: "Display Method",
              allowClear: false,
              descriptionLocation: "hidden",
              // Only the on-page code is offered (ADR 0012 R22: no Pop-up).
              choices: [{ value: "onPage", text: "On-Page" }],
              visible: !creatorTab,
            },
            {
              type: "boolean",
              renderAs: "checkbox",
              titleLocation: "hidden",
              name: "loadFromService",
              title: "Load Survey JSON from service",
              defaultValue: false,
              visible: !creatorTab && canLoad,
            },
          ],
        },
      ],
    },
    "customembedded",
  );
  const css = Object.assign({}, propertyGridCss) as typeof propertyGridCss;
  css.dropdown = { ...css.dropdown, controlInputFieldComponent: "spg-custom-dropdown-control" };
  css.root += " svc-custom-embedded-tab-properties";
  survey.getCss().list = {};
  survey.css = css;
  return survey;
}

/** What one Embed tab shows; the choices live in the sidebar's settings survey. */
class EmbedTabModel extends Base {
  readonly settings: ReturnType<typeof createSettingsSurvey>;
  private readonly sidebarPage: {
    visible: boolean;
    componentData: unknown;
    componentName: string;
    caption: string;
    id?: string;
  };

  constructor(
    readonly creator: SurveyCreator,
    readonly product: Product,
    readonly surveyId: string,
  ) {
    super();
    this.sidebarPage = creator.sidebar.addPage(
      product === "creator" ? "embedded-creator" : "embedded",
    );
    this.settings = createSettingsSurvey(creator, product, surveyId !== "");
  }

  override getType(): string {
    return "embedtab";
  }

  get platform(): EmbedPlatform {
    return this.settings.getValue("platform") as EmbedPlatform;
  }

  get loadFromService(): boolean {
    return this.settings.getValue("loadFromService") === true;
  }

  /** Shows the settings in the sidebar. */
  activate(): void {
    this.sidebarPage.componentData = this.settings;
    this.sidebarPage.componentName = "survey-widget";
    this.sidebarPage.caption = "Settings";
    this.creator.sidebar.activePage = this.sidebarPage.id ?? "";
  }

  deactivate(): void {
    this.sidebarPage.visible = false;
  }
}

/** The custom platform input of the settings dropdown: the platform's icon and name. */
function PlatformInput(props: { item?: { value: unknown; title: string } }) {
  const platform = EMBED_PLATFORMS.find((choice) => choice.value === props.item?.value);
  if (!props.item || !platform) return null;
  return (
    <div className="spg-custom-dropdown-input">
      <SvgIcon iconName={platform.iconName} size="auto" />
      <span className="spg-custom-dropdown-input__text">{props.item.title}</span>
    </div>
  );
}

/** The tab's component: both tabs use the site's one name. */
const COMPONENT = "svc-tab-customembeded";

/** A plain copy of a Creator value (the theme), without the Creator's own objects. */
const plain = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;

/** The theme of the survey, or `{}` when it has none (the Creator's empty theme included). */
function surveyTheme(creator: SurveyCreator): object {
  const theme = plain(creator.theme);
  const set = Object.entries(theme).filter(([key, value]) =>
    key === "cssVariables"
      ? value !== null && typeof value === "object" && Object.keys(value).length > 0
      : value !== undefined,
  );
  return set.length === 0 ? {} : theme;
}

function EmbedTab({ creator, model }: { creator: SurveyCreator; model: EmbedTabModel }) {
  const [, setVersion] = useState(0);
  // The sidebar's settings change the code.
  useEffect(() => {
    const changed = () => setVersion((version) => version + 1);
    model.settings.onValueChanged.add(changed);
    return () => model.settings.onValueChanged.remove(changed);
  }, [model]);
  // Read when the tab opens: it is rendered again each time it is selected.
  const [definition] = useState(() => plain(creator.JSON));
  const [theme] = useState(() => surveyTheme(creator));
  const { platform, loadFromService } = model;
  const creatorTab = model.product === "creator";
  const productText = creatorTab ? "Survey Creator" : "the survey";
  const blocks = creatorTab
    ? creatorEmbedCode({ platform, version: Version, definition })
    : surveyEmbedCode({
        platform,
        version: Version,
        origin: window.location.origin,
        surveyId: model.surveyId,
        loadFromService,
        definition,
        theme,
      });

  return (
    <div className={`svc-creator-tab__content svc-embed-tab ${styles.tab}`}>
      <div className="svc-embed-tab__top-message">
        To add {productText} to your application, use the code below. For detailed instructions,
        refer to the{" "}
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="svc-embed-tab__info-link"
          href={gettingStartedUrl(model.product, platform)}
        >
          Get Started
        </a>{" "}
        tutorial. You can also paste this code into an online code editor, such as{" "}
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="svc-embed-tab__info-link"
          href="https://plnkr.co/edit/"
        >
          Plunker
        </a>{" "}
        or{" "}
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="svc-embed-tab__info-link"
          href="https://codesandbox.io/"
        >
          CodeSandbox
        </a>{" "}
        to try it out.
      </div>
      {creatorTab && (
        <div className="svc-embed-tab__info-panel">
          Survey Creator is not available for free commercial usage. If you want to integrate it
          into your application, you must purchase a{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="svc-embed-tab__info-link"
            href="https://surveyjs.io/licensing"
          >
            commercial license
          </a>{" "}
          for{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="svc-embed-tab__info-link"
            href="https://surveyjs.io/faq#licensing-5"
          >
            each developer
          </a>{" "}
          who will be working with the SurveyJS product&apos;s APIs and implementing their
          integration.
        </div>
      )}
      {blocks.map((block, index) => (
        <CodeItem key={`${platform}-${index}`} block={block} />
      ))}
    </div>
  );
}

/**
 * Copies `text`, quietly doing nothing where the browser offers no clipboard (`navigator.clipboard`
 * is missing on pages served over plain HTTP) or refuses the write: the code can still be selected.
 */
function copyToClipboard(text: string): void {
  if (typeof navigator.clipboard?.writeText !== "function") return;
  navigator.clipboard.writeText(text).catch(() => {});
}

function CodeItem({ block }: { block: CodeBlock }) {
  return (
    <div className="svc-embed-tab__code">
      {block.name !== "" && (
        <div className="svc-embed-tab__code-header">
          <span>{block.name}</span>
        </div>
      )}
      <div className="svc-embed-tab__code-container" style={{ userSelect: "text" }}>
        <button
          type="button"
          className="svc-custom-embedded-tab__copy-button svc-toolbar__item"
          title="Copy Code"
          onClick={() => copyToClipboard(block.content)}
        >
          <SvgIcon title="Copy Code" iconName="icon-copyembedded" size="auto" />
        </button>
        <pre className="source-code source-code-embed svc-embed-tab__source-code" tabIndex={-1}>
          <code className={`content-js language-${block.language}`}>{block.content}</code>
        </pre>
      </div>
    </div>
  );
}

let registered = false;

function plugin(creator: SurveyCreator, product: Product, surveyId: string): ICreatorPlugin {
  const model = new EmbedTabModel(creator, product, surveyId);
  return {
    model,
    activate: () => model.activate(),
    deactivate: () => {
      model.deactivate();
      return true;
    },
  };
}

/** Adds the two Embed tabs, after the Creator's own tabs. */
export function addEmbedTabs(creator: SurveyCreator, surveyId: string): void {
  if (!registered) {
    registered = true;
    ReactElementFactory.Instance.registerElement("dropdown-custom-input", (props) =>
      createElement(PlatformInput, props as Parameters<typeof PlatformInput>[0]),
    );
    ReactElementFactory.Instance.registerElement(COMPONENT, (props) =>
      createElement(EmbedTab, props as { creator: SurveyCreator; model: EmbedTabModel }),
    );
  }
  creator.addTab({
    name: "customembeded",
    plugin: plugin(creator, "survey", surveyId),
    title: "Embed Survey",
    iconName: "icon-embedsurvey",
    componentName: COMPONENT,
  });
  creator.addTab({
    name: "customembededcreator",
    plugin: plugin(creator, "creator", surveyId),
    title: "Embed Creator",
    iconName: "icon-embedcreator",
    componentName: COMPONENT,
  });
}
