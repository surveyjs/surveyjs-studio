import { describe, expect, it } from "vitest";
import {
  creatorEmbedCode,
  EMBED_PLATFORMS,
  gettingStartedUrl,
  surveyEmbedCode,
  type CodeBlock,
  type EmbedPlatform,
} from "./embedCode";

const origin = "https://example.test";
const surveyId = "11111111-0000-4000-8000-000000000001";
const definition = { title: "Feedback", elements: [{ type: "text", name: "q1" }] };
const theme = { themeName: "flat", colorPalette: "light" };
const platforms = EMBED_PLATFORMS.map((choice) => choice.value);

const installLine = (blocks: readonly CodeBlock[]) => blocks[0]!.content;
const allCode = (blocks: readonly CodeBlock[]) => blocks.map((block) => block.content).join("\n");

/** The value of `export const <name> = …;` in the generated code, parsed back. */
function exported(blocks: readonly CodeBlock[], name: string): unknown {
  const match = new RegExp(`export const ${name} = ([\\s\\S]*?);\\n`).exec(allCode(blocks));
  if (match === null) throw new Error(`No ${name} in the code`);
  return JSON.parse(match[1]!);
}

const survey = (platform: EmbedPlatform, loadFromService: boolean, surveyTheme: object = theme) =>
  surveyEmbedCode({
    platform,
    version: "3.1.2",
    origin,
    surveyId,
    loadFromService,
    definition,
    theme: surveyTheme,
  });

describe("the platforms", () => {
  it("are Angular, React and VanillaJS, in the site's order", () => {
    expect(EMBED_PLATFORMS.map((choice) => choice.text)).toEqual(["Angular", "React", "VanillaJS"]);
  });

  it("link to the Get Started tutorials on surveyjs.io", () => {
    expect(gettingStartedUrl("survey", "react")).toBe(
      "https://surveyjs.io/form-library/documentation/get-started-react",
    );
    expect(gettingStartedUrl("survey", "vanillajs")).toBe(
      "https://surveyjs.io/form-library/documentation/get-started-html-css-javascript",
    );
    expect(gettingStartedUrl("creator", "angular")).toBe(
      "https://surveyjs.io/survey-creator/documentation/get-started-angular",
    );
  });
});

describe("the Embed Survey code", () => {
  const uiPackages: Record<EmbedPlatform, string> = {
    angular: "survey-angular-ui",
    react: "survey-react-ui",
    vanillajs: "survey-js-ui",
  };

  it.each(platforms)("%s: installs the platform's packages of the given version", (platform) => {
    const line = installLine(survey(platform, true));

    expect(line).toMatch(
      new RegExp(`^npm install survey-core@3\\.1\\.2 ${uiPackages[platform]}@3\\.1\\.2 --save`),
    );
  });

  it("adds the Angular component command to the install line", () => {
    expect(installLine(survey("angular", false))).toContain("\nng generate component survey");
  });

  it.each(platforms)(
    "%s: with 'Load Survey JSON from service', loads the survey and posts the answers",
    (platform) => {
      const code = allCode(survey(platform, true));

      expect(code).toContain(`"${origin}/api/v1/public/surveys/${surveyId}"`);
      expect(code).toContain('surveyUrl + "/responses"');
      expect(code).toContain("JSON.stringify({ data: sender.data })");
      expect(code).not.toContain('"Feedback"');
    },
  );

  it.each(platforms)("%s: without it, inlines the survey and theme JSON", (platform) => {
    const blocks = survey(platform, false);

    expect(exported(blocks, "json")).toEqual(definition);
    expect(exported(blocks, "themeJson")).toEqual(theme);
    expect(allCode(blocks)).toContain("console.log(JSON.stringify(sender.data, null, 3))");
    expect(allCode(blocks)).not.toContain("/api/v1/public/surveys");
  });

  it.each(platforms)("%s: leaves an empty theme out", (platform) => {
    const code = allCode(survey(platform, false, {}));

    expect(code).not.toContain("themeJson");
  });
});

describe("the Embed Creator code", () => {
  const creatorPackages: Record<EmbedPlatform, string> = {
    angular:
      "survey-core@3.1.2 survey-angular-ui@3.1.2 survey-creator-core@3.1.2 survey-creator-angular@3.1.2",
    react:
      "survey-core@3.1.2 survey-react-ui@3.1.2 survey-creator-core@3.1.2 survey-creator-react@3.1.2",
    vanillajs:
      "survey-core@3.1.2 survey-js-ui@3.1.2 survey-creator-core@3.1.2 survey-creator-js@3.1.2",
  };

  it.each(platforms)(
    "%s: installs the Creator packages and inlines the survey JSON",
    (platform) => {
      const blocks = creatorEmbedCode({ platform, version: "3.1.2", definition });

      expect(installLine(blocks)).toBe(`npm install ${creatorPackages[platform]} --save`);
      expect(exported(blocks, "json")).toEqual(definition);
    },
  );
});

describe("survey texts in the code", () => {
  const hostile = {
    title: `Say "hi" </script><script>alert('x')</script> \u2028 done`,
    elements: [{ type: "html", name: "intro", html: "<!-- <b>bold</b>" }],
  };

  it.each(platforms)("%s: cannot end a script or a string early", (platform) => {
    const blocks = [
      ...surveyEmbedCode({
        platform,
        version: "3.1.2",
        origin,
        surveyId,
        loadFromService: false,
        definition: hostile,
        theme: { cssVariables: { "--x": "</script>" } },
      }),
      ...creatorEmbedCode({ platform, version: "3.1.2", definition: hostile }),
    ];

    for (const name of ["json", "themeJson"]) {
      const match = new RegExp(`export const ${name} = ([\\s\\S]*?);\\n`).exec(allCode(blocks));
      expect(match![1]).not.toMatch(/<|\u2028/);
    }
    expect(exported(blocks, "json")).toEqual(hostile);
    expect(exported(blocks, "themeJson")).toEqual({ cssVariables: { "--x": "</script>" } });
  });
});
