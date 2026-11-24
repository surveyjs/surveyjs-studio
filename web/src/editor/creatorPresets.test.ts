import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCreator, type CreatorSession } from "./creatorSetup";

interface PresetChoice {
  readonly value: string;
}

interface SettingsElement {
  readonly componentData: {
    readonly model: {
      readonly survey: {
        getQuestionByName(name: string): { readonly choices: readonly PresetChoice[] } | null;
      };
    };
  };
}

/**
 * Creator settings lists Basic, Advanced, and Expert only when those presets are registered
 * before the Creator is built.
 */
describe("predefined Creator presets", () => {
  let session: CreatorSession | undefined;

  beforeEach(() => {
    // Monaco reads the OS color scheme when the Creator applies its editor theme.
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });

  afterEach(() => {
    session?.close();
    session = undefined;
  });

  it("offers basic, advanced, and expert in Creator settings", () => {
    session = createCreator({
      surveyId: "survey-1",
      saves: null,
      uploads: null,
      embed: false,
    });
    const page = session.creator.sidebar.getPageById("creatorTheme");
    const elements = (page.componentData as { elements: readonly SettingsElement[] }).elements;
    const preset = elements
      .map((element) => element.componentData.model.survey.getQuestionByName("presetName"))
      .find((question) => question !== null);

    expect(preset?.choices.map((choice) => choice.value)).toEqual(["basic", "advanced", "expert"]);
  });
});
