import { describe, expect, it } from "vitest";
import { fileLinks } from "./files.js";

const GUID = "0a1b2c3d-0000-4000-8000-00000000000a";
const url = (name: string) => `https://api.surveyjs.io/private/Surveys/files?name=${name}`;

describe("fileLinks", () => {
  it("finds editor asset links in nested definitions and themes, also inside HTML", () => {
    const json = {
      pages: [
        {
          elements: [
            { type: "image", imageLink: url(GUID) },
            {
              type: "html",
              html: `<img src='${url("b.png")}'> and <img src="${url("c.png")}&x=1">`,
            },
          ],
        },
      ],
      backgroundImage: url(GUID),
    };
    expect(fileLinks(json)).toEqual([
      { kind: "asset", name: GUID },
      { kind: "asset", name: "b.png" },
      { kind: "asset", name: "c.png" },
    ]);
  });

  it("finds respondent file links, also in arrays of files", () => {
    const json = {
      q1: `dxsimage:${GUID}.png`,
      q2: [
        { name: "a.pdf", type: "application/pdf", content: `dxsfile:${GUID}.pdf` },
        { name: "b", content: "data:image/png;base64,AAAA" },
      ],
    };
    expect(fileLinks(json)).toEqual([
      { kind: "response", name: `${GUID}.png` },
      { kind: "response", name: `${GUID}.pdf` },
    ]);
  });

  it("ignores names the legacy rule refuses and plain text", () => {
    expect(
      fileLinks({ a: "dxsfile:../x", b: url("a%2Fb"), c: "see dxsfile:abc", d: 5, e: null }),
    ).toEqual([]);
  });

  it("finds a link through the old private/v1 route, in any letter case, the name anywhere in the query", () => {
    const v1 = `https://api.surveyjs.io/private/v1/Surveys/files?name=${GUID}`;
    const html = `<img src="https://surveyjs.io/PRIVATE/surveys/Files?x=1&amp;name=b.png">`;
    expect(
      fileLinks({
        a: v1,
        b: html,
        c: `https://surveyjs.io/private/Surveys/files?filename=x&Name=c.png#top`,
        d: `https://surveyjs.io/private/Surveys/files?filename=d.png`,
      }),
    ).toEqual([
      { kind: "asset", name: GUID },
      { kind: "asset", name: "b.png" },
      { kind: "asset", name: "c.png" },
    ]);
  });

  it("reads a decoded name", () => {
    expect(fileLinks({ a: url("a%2Eb") })).toEqual([{ kind: "asset", name: "a.b" }]);
  });
});
