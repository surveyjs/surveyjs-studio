import { describe, expect, it } from "vitest";
import { bindJsonBody, parseLenientJson } from "./json-body.js";

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

describe("reading time", () => {
  const MB = 1024 * 1024;
  const timed = (run: () => unknown): number => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it.each([
    ["a long refused number", `{"x":${"1".repeat(MB)}a}`],
    ["a long refused number as a boolean", `{"isPartialCompleted":${"1".repeat(MB)}a}`],
    ["a long refused GUID number", `{"postId":${"0".repeat(MB)}1}`],
    ["interior whitespace in a boolean string", `{"isPartialCompleted":"t${" ".repeat(MB)}x"}`],
    ["a long string", `{"surveyResult":"${"a".repeat(MB)}"}`],
    ["a long string with escapes", `{"surveyResult":"${"\\n".repeat(MB / 2)}"}`],
    ["a long bare property name", `{${"a".repeat(MB)}:1}`],
    [
      "capped nesting, repeated",
      `{"x":[${`${"[".repeat(30)}${"]".repeat(30)},`.repeat(MB / 64)}0]}`,
    ],
    ["many properties", `{${'"surveyResult":"x",'.repeat(MB / 20)}"a":1}`],
    ["many errors", `{${'"isPartialCompleted":"no",'.repeat(MB / 26)}"a":1}`],
    ["a long comment", `/*${"*".repeat(MB)}*/{}`],
  ])("binds %s (about 1 MB) in linear time", (_case, body) => {
    expect(timed(() => bindJsonBody(body, PROPERTIES))).toBeLessThan(1_000);
  });

  it("parses long answers in linear time", () => {
    const body = `{${'"q":[1,{"a":"b"}],'.repeat(MB / 19)}"z":${"1".repeat(1000)}a}`;
    expect(timed(() => parseLenientJson(body))).toBeLessThan(1_000);
  });

  // A seeded generator, so a failure repeats.
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }
  const ALPHABET = "{}[]:,\"'\\/*-+.0123456789eEtrufalsnNIxyX \n\r\t\u0000é";

  function text(next: () => number, length: number): string {
    let result = "";
    for (let i = 0; i < length; i += 1) result += ALPHABET[Math.floor(next() * ALPHABET.length)];
    return result;
  }

  it("never fails on JSON-ish noise with anything but a binding answer", () => {
    const next = random(42);
    for (let i = 0; i < 5_000; i += 1) {
      const body = (next() < 0.5 ? '{"postId":' : "") + text(next, Math.floor(next() * 120));
      const result = bindJsonBody(body, PROPERTIES);
      for (const messages of Object.values(result.errors)) {
        expect(messages.every((message) => typeof message === "string")).toBe(true);
      }
      expect(() => parseLenientJson(body)).not.toThrow();
    }
  });

  it("reads 1 MB of noise in linear time", () => {
    const body = `{"x":${text(random(7), MB)}`;
    expect(timed(() => bindJsonBody(body, PROPERTIES))).toBeLessThan(1_000);
    expect(timed(() => parseLenientJson(body))).toBeLessThan(1_000);
  });
});

describe("keys named like an object's own members", () => {
  it.each(["__proto__", "constructor", "toString"])("lists an error under %s", (name) => {
    const result = bindJsonBody(`{"${name}":1 x}`, PROPERTIES);
    expect(Object.keys(result.errors)).toEqual([name]);
    expect(result.errors[name]).toEqual([
      `After parsing a value an unexpected character was encountered: x. Path '${name}', line 1, position ${name.length + 6}.`,
    ]);
  });
});

describe("stored answers", () => {
  it("parse with the old reader's lenient syntax", () => {
    expect(
      parseLenientJson(`/*c*/ {q: 1, 'a': 'b', arr: [1, 2,], n: null, t: true, f: 1.5e1,} // end`),
    ).toEqual({
      value: { q: 1, a: "b", arr: [1, 2], n: null, t: true, f: 15 },
    });
  });

  it("keep a question named __proto__ as an ordinary answer", () => {
    const parsed = parseLenientJson(`{"__proto__":{"x":1}}`)!.value as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(JSON.stringify(parsed)).toBe(`{"__proto__":{"x":1}}`);
  });

  it.each([
    ["content after the value", `{"q":1} x`],
    ["an unterminated object", `{"q":1`],
    ["an unterminated string", `{"q":"1}`],
    ["empty text", ""],
  ])("refuse %s", (_case, text) => {
    expect(parseLenientJson(text)).toBeUndefined();
  });

  it("allow nesting up to 64", () => {
    const nested = (depth: number) => `${"[".repeat(depth)}${"]".repeat(depth)}`;
    expect(parseLenientJson(nested(64))).toBeDefined();
    expect(parseLenientJson(nested(65))).toBeUndefined();
  });
});
