import { describe, expect, it } from "vitest";
import { bindJsonBody } from "./json-body.js";

const PROPERTIES = {
  postId: "guid",
  surveyResult: "string",
  isPartialCompleted: "boolean",
} as const;
const GUID = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";

describe("the old JSON body binding", () => {
  it("binds the known properties, the last of a repeated one winning", () => {
    const result = bindJsonBody(
      `{"postId":"${GUID.toUpperCase()}","surveyResult":"a","surveyResult":"b","isPartialCompleted":1}`,
      PROPERTIES,
    );
    expect(result).toEqual({
      model: { postId: GUID, surveyResult: "b", isPartialCompleted: true },
      errors: {},
    });
  });

  it("prefers the property spelled exactly, then any letter case", () => {
    const result = bindJsonBody(`{"SURVEYRESULT":"x"}`, PROPERTIES);
    expect(result.model).toEqual({ surveyResult: "x" });
  });

  it("reads numbers and literals as strings where a string is bound", () => {
    expect(bindJsonBody(`{"surveyResult":1.50}`, PROPERTIES).model).toEqual({
      surveyResult: "1.50",
    });
    expect(bindJsonBody(`{"surveyResult":true}`, PROPERTIES).model).toEqual({
      surveyResult: "true",
    });
    expect(bindJsonBody(`{"surveyResult":null}`, PROPERTIES).model).toEqual({ surveyResult: null });
  });

  it("decodes string escapes", () => {
    const result = bindJsonBody(`{"surveyResult":"a\\"b\\\\c\\n\\u00e9\\/"}`, PROPERTIES);
    expect(result.model).toEqual({ surveyResult: 'a"b\\c\né/' });
  });

  it("skips unknown properties of any depth", () => {
    const result = bindJsonBody(
      `{"x":{"y":[1,{"z":[[]]}],"w":null},"surveyResult":"s"}`,
      PROPERTIES,
    );
    expect(result).toEqual({ model: { surveyResult: "s" }, errors: {} });
  });

  it("collects every conversion error, each under its path", () => {
    const result = bindJsonBody(
      `{"postId":true,"isPartialCompleted":"yes","surveyResult":"ok"}`,
      PROPERTIES,
    );
    expect(result.errors).toEqual({
      postId: [
        "Error converting value True to type 'System.Guid'. Path 'postId', line 1, position 14.",
      ],
      isPartialCompleted: [
        "Could not convert string to boolean: yes. Path 'isPartialCompleted', line 1, position 41.",
      ],
    });
  });

  it.each([
    [
      `{"postId":null}`,
      `Error converting value {null} to type 'System.Guid'. Path 'postId', line 1, position 14.`,
    ],
    [
      `{"postId":""}`,
      `Error converting value "" to type 'System.Guid'. Path 'postId', line 1, position 12.`,
    ],
  ])("refuses %s as a GUID", (body, message) => {
    expect(bindJsonBody(body, PROPERTIES).errors).toEqual({ postId: [message] });
  });

  it("names a property with special characters in brackets", () => {
    const result = bindJsonBody(`{"a b":1 x}`, PROPERTIES);
    expect(result.errors).toEqual({
      "['a b']": [
        "After parsing a value an unexpected character was encountered: x. Path '['a b']', line 1, position 9.",
      ],
    });
  });

  it("refuses nesting deeper than 32 containers", () => {
    const nested = (arrays: number) => `{"x":${"[".repeat(arrays)}${"]".repeat(arrays)}}`;
    expect(bindJsonBody(nested(31), PROPERTIES).errors).toEqual({});
    const messages = Object.values(bindJsonBody(nested(32), PROPERTIES).errors).flat();
    expect(messages[0]).toMatch(
      /^The reader's MaxDepth of 32 has been exceeded\. Path 'x(\[0\]){31}', line 1, position 37\.$/,
    );
  });

  it("answers no model for an empty body or null", () => {
    expect(bindJsonBody("", PROPERTIES)).toEqual({ model: null, errors: {} });
    expect(bindJsonBody(" \r\n null ", PROPERTIES)).toEqual({ model: null, errors: {} });
  });

  it("ignores content after the object", () => {
    expect(bindJsonBody(`{"surveyResult":"a"} trailing`, PROPERTIES)).toEqual({
      model: { surveyResult: "a" },
      errors: {},
    });
  });
});
