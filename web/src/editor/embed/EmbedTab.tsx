// The "Embed Survey" and "Embed Creator" tabs of surveyjs.io's editor (Scripts/Models/embed-tab.tsx):
// their names, titles, icons, texts and class names are the site's (D14); the component is our own.
// The settings are in the tab itself, not in the Creator's sidebar. Part of the Creator chunk.
import { createElement, useState } from "react";
import { Base, Version } from "survey-core";
import type { ICreatorPlugin } from "survey-creator-core";
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

/** What one Embed tab shows; the choices stay while the editor is open. */
class EmbedTabModel extends Base {
  platform: EmbedPlatform = DEFAULT_PLATFORM;
  loadFromService = false;

  constructor(
    readonly product: Product,
    readonly surveyId: string,
  ) {
    super();
  }

  override getType(): string {
    return "embedtab";
  }

  /** Keeps the tab's choices for the next time it opens. */
  remember(choices: { platform?: EmbedPlatform; loadFromService?: boolean }): void {
    this.platform = choices.platform ?? this.platform;
    this.loadFromService = choices.loadFromService ?? this.loadFromService;
  }
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
  const [platform, setPlatform] = useState(model.platform);
  const [loadFromService, setLoadFromService] = useState(model.loadFromService);
  // Read when the tab opens: it is rendered again each time it is selected.
  const [definition] = useState(() => plain(creator.JSON));
  const [theme] = useState(() => surveyTheme(creator));
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
        tutorial.
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
      <div className={styles.settings}>
        <fieldset className={styles.platforms}>
          <legend className={styles.legend}>Select Platform</legend>
          {EMBED_PLATFORMS.map((choice) => (
            <label
              key={choice.value}
              className={`${styles.platform} spg-platform-choice${choice.value === platform ? ` ${styles.selected}` : ""}`}
            >
              <input
                type="radio"
                name={`${model.product}-platform`}
                className={styles.radio}
                value={choice.value}
                checked={choice.value === platform}
                onChange={() => {
                  model.remember({ platform: choice.value });
                  setPlatform(choice.value);
                }}
              />
              <SvgIcon iconName={choice.iconName} size={24} />
              <span>{choice.text}</span>
            </label>
          ))}
        </fieldset>
        {!creatorTab && (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={loadFromService}
              onChange={(event) => {
                model.remember({ loadFromService: event.target.checked });
                setLoadFromService(event.target.checked);
              }}
            />
            Load Survey JSON from service
          </label>
        )}
      </div>
      {blocks.map((block, index) => (
        <CodeItem key={`${platform}-${index}`} block={block} />
      ))}
    </div>
  );
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
          onClick={() => void navigator.clipboard.writeText(block.content)}
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

function plugin(product: Product, surveyId: string): ICreatorPlugin {
  return {
    model: new EmbedTabModel(product, surveyId),
    activate: () => {},
    deactivate: () => true,
  };
}

/** Adds the two Embed tabs, after the Creator's own tabs. */
export function addEmbedTabs(creator: SurveyCreator, surveyId: string): void {
  if (!registered) {
    registered = true;
    ReactElementFactory.Instance.registerElement(COMPONENT, (props) =>
      createElement(EmbedTab, props as { creator: SurveyCreator; model: EmbedTabModel }),
    );
  }
  creator.addTab({
    name: "customembeded",
    plugin: plugin("survey", surveyId),
    title: "Embed Survey",
    iconName: "icon-embedsurvey",
    componentName: COMPONENT,
  });
  creator.addTab({
    name: "customembededcreator",
    plugin: plugin("creator", surveyId),
    title: "Embed Creator",
    iconName: "icon-embedcreator",
    componentName: COMPONENT,
  });
}
