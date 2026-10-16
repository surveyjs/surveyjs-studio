// The code shown in the editor's "Embed Survey" and "Embed Creator" tabs. surveyjs.io takes it from
// example projects kept with the site; these templates are our own, for the SurveyJS packages of the
// version the app uses and for this service's public endpoints.

export type EmbedPlatform = "angular" | "react" | "vanillajs";

export interface PlatformChoice {
  readonly value: EmbedPlatform;
  readonly text: string;
  readonly iconName: string;
}

/**
 * The site's platform choices, in its order, without jQuery: SurveyJS has no jQuery package of the
 * app's version (the VanillaJS packages cover jQuery).
 */
export const EMBED_PLATFORMS: readonly PlatformChoice[] = [
  { value: "angular", text: "Angular", iconName: "icon-angular" },
  { value: "react", text: "React", iconName: "icon-react" },
  { value: "vanillajs", text: "VanillaJS", iconName: "icon-vanillajs" },
];

/** The site's default choice. */
export const DEFAULT_PLATFORM: EmbedPlatform = "react";

export interface CodeBlock {
  /** The file the code goes in; empty for the install command. */
  readonly name: string;
  readonly language: "shell" | "javascript" | "typescript" | "html";
  readonly content: string;
}

type Product = "survey" | "creator";

const TUTORIALS: Record<Product, string> = {
  survey: "https://surveyjs.io/form-library/documentation/",
  creator: "https://surveyjs.io/survey-creator/documentation/",
};
const TUTORIAL_PAGES: Record<EmbedPlatform, string> = {
  angular: "get-started-angular",
  react: "get-started-react",
  vanillajs: "get-started-html-css-javascript",
};

/** The Get Started tutorial for `product` on `platform`, on surveyjs.io. */
export function gettingStartedUrl(product: Product, platform: EmbedPlatform): string {
  return TUTORIALS[product] + TUTORIAL_PAGES[platform];
}

const UI_PACKAGES: Record<EmbedPlatform, string> = {
  angular: "survey-angular-ui",
  react: "survey-react-ui",
  vanillajs: "survey-js-ui",
};
const CREATOR_PACKAGES: Record<EmbedPlatform, string> = {
  angular: "survey-creator-angular",
  react: "survey-creator-react",
  vanillajs: "survey-creator-js",
};

/**
 * `value` as a JavaScript literal (indented JSON) that is safe anywhere in a page: `<` is written as
 * `<`, so no text can close a `<script>` element or open an HTML comment, and the line and
 * paragraph separators are escaped too.
 */
function literal(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const isEmpty = (value: object) => Object.keys(value).length === 0;

function install(packages: readonly string[], version: string, nextLine = ""): CodeBlock {
  const names = packages.map((name) => `${name}@${version}`).join(" ");
  return { name: "", language: "shell", content: `npm install ${names} --save${nextLine}` };
}

function jsonFile(platform: EmbedPlatform, file: string, name: string, value: unknown): CodeBlock {
  const typescript = platform === "angular";
  return {
    name: `${file}.${typescript ? "ts" : "js"}`,
    language: typescript ? "typescript" : "javascript",
    content: `export const ${name} = ${literal(value)};\n`,
  };
}

/** The service module of "Load Survey JSON from service": loads the survey, posts the answers. */
function serviceFile(platform: EmbedPlatform, surveyUrl: string): CodeBlock {
  const typescript = platform === "angular";
  const types = typescript ? ", type CompleteEvent, type SurveyModel" : "";
  const parameters = typescript ? "sender: SurveyModel, options: CompleteEvent" : "sender, options";
  return {
    name: typescript ? "service.ts" : "service.js",
    language: typescript ? "typescript" : "javascript",
    content: `import { Model${types} } from "survey-core";

const surveyUrl = ${literal(surveyUrl)};

// Loads the published survey (its JSON and theme) from the service.
export async function loadSurvey() {
  const response = await fetch(surveyUrl);
  if (!response.ok) {
    throw new Error("Could not load the survey (" + response.status + ")");
  }
  const { definition, theme } = await response.json();
  const survey = new Model(definition);
  survey.applyTheme(theme);
  survey.onComplete.add(postResults);
  return survey;
}

// Sends the respondent's answers to the service.
function postResults(${parameters}) {
  options.showSaveInProgress();
  fetch(surveyUrl + "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: sender.data }),
  })
    .then((response) => (response.ok ? options.showSaveSuccess() : options.showSaveError()))
    .catch(() => options.showSaveError());
}
`,
  };
}

/** The statements that build `survey` from the inlined JSON (indented by `indent`). */
function inlineSurvey(hasTheme: boolean, indent: string): string {
  return [
    "const survey = new Model(json);",
    ...(hasTheme ? ["survey.applyTheme(themeJson);"] : []),
    "survey.onComplete.add((sender) => {",
    "  console.log(JSON.stringify(sender.data, null, 3));",
    "});",
  ]
    .map((line) => indent + line)
    .join("\n");
}

function inlineImports(hasTheme: boolean): string {
  return [
    'import { json } from "./json";',
    ...(hasTheme ? ['import { themeJson } from "./theme";'] : []),
  ].join("\n");
}

function reactSurvey(service: boolean, hasTheme: boolean): CodeBlock {
  const content = service
    ? `import { useEffect, useState } from "react";
import { Survey } from "survey-react-ui";
import "survey-core/survey-core.css";
import { loadSurvey } from "./service";

export default function SurveyComponent() {
  const [survey, setSurvey] = useState(null);
  useEffect(() => {
    let active = true;
    loadSurvey()
      .then((loaded) => {
        if (active) setSurvey(loaded);
      })
      .catch((error) => console.error("Could not load the survey:", error));
    return () => {
      active = false;
    };
  }, []);
  return survey && <Survey model={survey} />;
}
`
    : `import { useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/survey-core.css";
${inlineImports(hasTheme)}

export default function SurveyComponent() {
  const [model] = useState(() => {
${inlineSurvey(hasTheme, "    ")}
    return survey;
  });
  return <Survey model={model} />;
}
`;
  return { name: "SurveyComponent.jsx", language: "javascript", content };
}

function angularSurvey(service: boolean, hasTheme: boolean): CodeBlock[] {
  const component = service
    ? `import { Component, OnInit } from "@angular/core";
import { Model } from "survey-core";
import { SurveyModule } from "survey-angular-ui";
import { loadSurvey } from "./service";

// Add "node_modules/survey-core/survey-core.min.css" to "styles" in angular.json.
@Component({
  selector: "app-survey",
  standalone: true,
  imports: [SurveyModule],
  templateUrl: "./survey.component.html",
})
export class SurveyComponent implements OnInit {
  surveyModel: Model | null = null;

  ngOnInit() {
    loadSurvey()
      .then((survey) => (this.surveyModel = survey))
      .catch((error: unknown) => console.error("Could not load the survey:", error));
  }
}
`
    : `import { Component, OnInit } from "@angular/core";
import { Model } from "survey-core";
import { SurveyModule } from "survey-angular-ui";
${inlineImports(hasTheme)}

// Add "node_modules/survey-core/survey-core.min.css" to "styles" in angular.json.
@Component({
  selector: "app-survey",
  standalone: true,
  imports: [SurveyModule],
  templateUrl: "./survey.component.html",
})
export class SurveyComponent implements OnInit {
  surveyModel: Model | null = null;

  ngOnInit() {
${inlineSurvey(hasTheme, "    ")}
    this.surveyModel = survey;
  }
}
`;
  return [
    { name: "survey.component.ts", language: "typescript", content: component },
    {
      name: "survey.component.html",
      language: "html",
      content: `@if (surveyModel) {\n  <survey [model]="surveyModel"></survey>\n}\n`,
    },
  ];
}

function vanillaSurvey(service: boolean, hasTheme: boolean): CodeBlock[] {
  const script = service
    ? `import { renderSurvey } from "survey-js-ui";
import "survey-core/survey-core.css";
import { loadSurvey } from "./service";

loadSurvey()
  .then((survey) => {
    renderSurvey(survey, document.getElementById("surveyContainer"));
  })
  .catch((error) => console.error("Could not load the survey:", error));
`
    : `import { Model } from "survey-core";
import { renderSurvey } from "survey-js-ui";
import "survey-core/survey-core.css";
${inlineImports(hasTheme)}

${inlineSurvey(hasTheme, "")}
renderSurvey(survey, document.getElementById("surveyContainer"));
`;
  return [
    {
      name: "index.html",
      language: "html",
      content: `<div id="surveyContainer"></div>\n<script type="module" src="./index.js"></script>\n`,
    },
    { name: "index.js", language: "javascript", content: script },
  ];
}

/**
 * The "Embed Survey" code for `platform`: the install command, then the files. With
 * `loadFromService` the code loads the published survey from this service (`origin`) and posts the
 * answers there; otherwise the survey JSON (and the theme JSON, when there is one) is inlined and the
 * answers are logged.
 */
export function surveyEmbedCode(options: {
  readonly platform: EmbedPlatform;
  /** The SurveyJS version of the packages. */
  readonly version: string;
  /** The origin of this service (`window.location.origin`). */
  readonly origin: string;
  readonly surveyId: string;
  readonly loadFromService: boolean;
  readonly definition: object;
  readonly theme: object;
}): CodeBlock[] {
  const { platform, loadFromService: service } = options;
  const hasTheme = !service && !isEmpty(options.theme);
  const blocks: CodeBlock[] = [
    install(
      ["survey-core", UI_PACKAGES[platform]],
      options.version,
      platform === "angular" ? "\nng generate component survey" : "",
    ),
  ];
  if (service) {
    const surveyUrl = `${options.origin}/api/v1/public/surveys/${encodeURIComponent(options.surveyId)}`;
    blocks.push(serviceFile(platform, surveyUrl));
  } else {
    blocks.push(jsonFile(platform, "json", "json", options.definition));
    if (hasTheme) blocks.push(jsonFile(platform, "theme", "themeJson", options.theme));
  }
  if (platform === "react") blocks.push(reactSurvey(service, hasTheme));
  else if (platform === "angular") blocks.push(...angularSurvey(service, hasTheme));
  else blocks.push(...vanillaSurvey(service, hasTheme));
  return blocks;
}

const CREATOR_SETUP = `creator.JSON = json;
creator.saveSurveyFunc = (saveNo, callback) => {
  // Save creator.JSON to your storage here.
  console.log(JSON.stringify(creator.JSON, null, 3));
  callback(saveNo, true);
};`;

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line) => by + line)
    .join("\n");

function creatorFiles(platform: EmbedPlatform): CodeBlock[] {
  if (platform === "react") {
    return [
      {
        name: "SurveyCreatorWidget.jsx",
        language: "javascript",
        content: `import { useState } from "react";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { json } from "./json";

export default function SurveyCreatorWidget() {
  const [creator] = useState(() => {
    const creator = new SurveyCreator({ autoSaveEnabled: true });
${indent(CREATOR_SETUP, "    ")}
    return creator;
  });
  return (
    <div style={{ height: "100vh" }}>
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
`,
      },
    ];
  }
  if (platform === "angular") {
    return [
      {
        name: "survey-creator.component.ts",
        language: "typescript",
        content: `import { Component, OnInit } from "@angular/core";
import { SurveyCreatorModel } from "survey-creator-core";
import { SurveyCreatorModule } from "survey-creator-angular";
import { json } from "./json";

// Add "node_modules/survey-core/survey-core.min.css" and
// "node_modules/survey-creator-core/survey-creator-core.min.css" to "styles" in angular.json.
@Component({
  selector: "app-survey-creator",
  standalone: true,
  imports: [SurveyCreatorModule],
  templateUrl: "./survey-creator.component.html",
})
export class SurveyCreatorComponent implements OnInit {
  creator: SurveyCreatorModel | null = null;

  ngOnInit() {
    const creator = new SurveyCreatorModel({ autoSaveEnabled: true });
${indent(CREATOR_SETUP.replace("(saveNo, callback)", "(saveNo: number, callback: (no: number, success: boolean) => void)"), "    ")}
    this.creator = creator;
  }
}
`,
      },
      {
        name: "survey-creator.component.html",
        language: "html",
        content: `@if (creator) {\n  <div style="height: 100vh">\n    <survey-creator [model]="creator"></survey-creator>\n  </div>\n}\n`,
      },
    ];
  }
  return [
    {
      name: "index.html",
      language: "html",
      content: `<div id="surveyCreator" style="height: 100vh"></div>\n<script type="module" src="./index.js"></script>\n`,
    },
    {
      name: "index.js",
      language: "javascript",
      content: `import { SurveyCreator } from "survey-creator-js";
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { json } from "./json";

const creator = new SurveyCreator({ autoSaveEnabled: true });
${CREATOR_SETUP}
creator.render(document.getElementById("surveyCreator"));
`,
    },
  ];
}

/**
 * The "Embed Creator" code for `platform`: the install command, the survey JSON to start from and
 * the files that show Survey Creator with it.
 */
export function creatorEmbedCode(options: {
  readonly platform: EmbedPlatform;
  readonly version: string;
  readonly definition: object;
}): CodeBlock[] {
  const { platform } = options;
  return [
    install(
      ["survey-core", UI_PACKAGES[platform], "survey-creator-core", CREATOR_PACKAGES[platform]],
      options.version,
    ),
    jsonFile(platform, "json", "json", options.definition),
    ...creatorFiles(platform),
  ];
}
