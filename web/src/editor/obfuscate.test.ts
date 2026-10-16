import { describe, expect, it } from "vitest";
import { obfuscateSurvey } from "./obfuscate";

// Always the first letter of the alphabet: "A" for capitals, "a" for small letters.
const first = () => 0;
// Always the last one: "Z" / "z".
const last = () => 0.999;

const obfuscate = (json: object, random = first) =>
  JSON.parse(obfuscateSurvey(json, random)) as Record<string, unknown>;

type Json = Record<string, unknown>;
const elementsOf = (page: unknown) => (page as { elements: Json[] }).elements;

describe("obfuscateSurvey", () => {
  it("renames panels to panel1… and questions to q1…", () => {
    const result = obfuscate({
      pages: [
        {
          name: "page1",
          elements: [
            { type: "text", name: "firstName" },
            {
              type: "panel",
              name: "address",
              elements: [
                { type: "text", name: "street" },
                { type: "panel", name: "inner", elements: [{ type: "text", name: "zip" }] },
              ],
            },
          ],
        },
        { name: "page2", elements: [{ type: "comment", name: "notes" }] },
      ],
    });

    const [page1, page2] = result["pages"] as Json[];
    const [first, panel] = elementsOf(page1);
    expect(first!["name"]).toBe("q1");
    expect(panel!["name"]).toBe("panel1");
    const [street, inner] = elementsOf(panel);
    expect(street!["name"]).toBe("q2");
    expect(inner!["name"]).toBe("panel2");
    expect(elementsOf(inner)[0]!["name"]).toBe("q3");
    expect(elementsOf(page2)[0]!["name"]).toBe("q4");
  });

  it("removes html questions", () => {
    const result = obfuscate({
      elements: [
        { type: "html", name: "intro", html: "<p>Secret</p>" },
        { type: "text", name: "answer" },
      ],
    });

    const elements = elementsOf((result["pages"] as Json[])[0]);
    expect(elements).toEqual([{ type: "text", name: "q1" }]);
    expect(JSON.stringify(result)).not.toContain("Secret");
  });

  it("changes the ASCII letters of texts and keeps their length, case, digits, spaces and other characters", () => {
    const result = obfuscate(
      {
        title: "My Survey 2024",
        description: "Über café",
        elements: [
          {
            type: "radiogroup",
            name: "color",
            title: "Pick ONE color",
            description: "Only 1!",
            requiredErrorText: "Required",
            otherText: "Other",
            choices: [{ value: "r", text: "Red" }, { value: "g", text: "Green 2" }, "plain"],
          },
        ],
      },
      last,
    );

    expect(result["title"]).toBe("Zz Zzzzzz 2024");
    expect(result["description"]).toBe("Üzzz zzzé");
    const question = elementsOf((result["pages"] as Json[])[0])[0]!;
    expect(question["title"]).toBe("Zzzz ZZZ zzzzz");
    expect(question["description"]).toBe("Zzzz 1!");
    expect(question["requiredErrorText"]).toBe("Zzzzzzzz");
    expect(question["otherText"]).toBe("Zzzzz");
    // Values stay: answers and expressions use them.
    expect(question["choices"]).toEqual([
      { value: "r", text: "Zzz" },
      { value: "g", text: "Zzzzz 2" },
      "plain",
    ]);
  });

  it("scrambles the texts of matrix rows, columns and validators", () => {
    const result = obfuscate({
      elements: [
        {
          type: "matrix",
          name: "quality",
          columns: [{ value: 1, text: "Bad" }],
          rows: [{ value: "speed", text: "Speed" }],
          validators: [{ type: "expression", text: "Wrong", expression: "{quality} notempty" }],
        },
        {
          type: "matrixdropdown",
          name: "grid",
          columns: [{ name: "col", title: "Column" }],
          rows: ["one"],
        },
      ],
    });

    const [matrix, dropdown] = elementsOf((result["pages"] as Json[])[0]);
    expect(matrix!["columns"]).toEqual([{ value: 1, text: "Aaa" }]);
    expect(matrix!["rows"]).toEqual([{ value: "speed", text: "Aaaaa" }]);
    expect(matrix!["validators"]).toEqual([
      { type: "expression", text: "Aaaaa", expression: "{q1} notempty" },
    ]);
    // Matrix columns are renamed as questions are.
    expect(dropdown!["columns"]).toEqual([{ name: "q3", title: "Aaaaaa" }]);
  });

  it("scrambles every locale of a localized text", () => {
    const result = obfuscate({
      title: { default: "Hello", de: "Hallo Welt", fr: "Bonjour" },
      elements: [{ type: "text", name: "name", placeholder: { default: "Name", de: "Ihr Name" } }],
    });

    expect(result["title"]).toEqual({ default: "Aaaaa", de: "Aaaaa Aaaa", fr: "Aaaaaaa" });
    const question = elementsOf((result["pages"] as Json[])[0])[0]!;
    expect(question["placeholder"]).toEqual({ default: "Aaaa", de: "Aaa Aaaa" });
  });

  it("renames the questions in expressions: {old}, {panel.old}, {row.old}", () => {
    const result = obfuscate({
      elements: [
        { type: "text", name: "age" },
        { type: "text", name: "Score", visibleIf: "{AGE} > 18 and {age.length} > 0" },
        {
          type: "paneldynamic",
          name: "people",
          templateElements: [
            { type: "text", name: "pet" },
            { type: "text", name: "petName", visibleIf: "{panel.pet} notempty" },
          ],
        },
        {
          type: "matrixdynamic",
          name: "rowsQ",
          columns: [{ name: "age", visibleIf: "{row.age[0]} = 1" }],
        },
        { type: "expression", name: "total", expression: "{score} + {ageless} + {page}" },
      ],
    });

    const [age, score, people, rows, total] = elementsOf((result["pages"] as Json[])[0]);
    expect(age!["name"]).toBe("q1");
    // The conditions are not run.
    expect(score!["visible"]).toBeUndefined();
    expect(score!["visibleIf"]).toBe("{q1} > 18 and {q1.length} > 0");
    const [pet, petName] = (people as { templateElements: Json[] }).templateElements;
    expect(pet!["name"]).toBe("q4");
    expect(petName!["visibleIf"]).toBe("{panel.q4} notempty");
    expect((rows!["columns"] as Json[])[0]!["visibleIf"]).toBe("{row.q7[0]} = 1");
    // Names that only start like a question name are not renamed.
    expect(total!["expression"]).toBe("{q2} + {ageless} + {page}");
  });

  it("renames names with regular-expression characters", () => {
    const result = obfuscate({
      elements: [
        { type: "text", name: "q.1(a)" },
        { type: "text", name: "q11a", visibleIf: "{q.1(a)} = 1 or {q11a} = 2" },
      ],
    });

    const [, second] = elementsOf((result["pages"] as Json[])[0]);
    expect(second!["visibleIf"]).toBe("{q1} = 1 or {q2} = 2");
  });

  it("does not rename twice when a new name is an old one", () => {
    const result = obfuscate({
      elements: [
        { type: "text", name: "q2" },
        { type: "text", name: "q1", visibleIf: "{q2} = {q1}" },
      ],
    });

    const [, second] = elementsOf((result["pages"] as Json[])[0]);
    expect(second!["visibleIf"]).toBe("{q1} = {q2}");
  });

  it("returns JSON indented with two spaces", () => {
    const text = obfuscateSurvey({ elements: [{ type: "text", name: "a" }] }, first);

    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(text).toContain('\n  "pages": [');
  });
});
