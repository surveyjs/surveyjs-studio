import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  dotnetDouble,
  oldJson,
  oldNumberText,
  oldTime,
  parseDateArgument,
  parseOldDate,
  parseStudioJson,
  questionResultEntries,
} from "./dotnet-format.js";

/** `questionResultEntries` of values given as JSON text, as Studio sends them. */
function entries(valuesJson: string): [string, number][] {
  return questionResultEntries(
    parseStudioJson(valuesJson) as Parameters<typeof questionResultEntries>[0],
  );
}

/** Times a call on adversarial input: linear code takes milliseconds for a megabyte. */
function expectFast(run: () => unknown): void {
  const started = performance.now();
  run();
  expect(performance.now() - started).toBeLessThan(1_000);
}

describe("questionResultEntries: the old QuestionResult keys", () => {
  it("writes booleans as True and False", () => {
    expect(entries('[{"value":true,"count":2},{"value":false,"count":1}]')).toEqual([
      ["True", 2],
      ["False", 1],
    ]);
  });

  it("writes an object answer's [key, value] pair as [r1, c1]", () => {
    expect(entries('[{"value":["r1","c1"],"count":3},{"value":["r2",5],"count":1}]')).toEqual([
      ["[r1, c1]", 3],
      ["[r2, 5]", 1],
    ]);
  });

  it("writes a date-like string as MM/dd/yyyy HH:mm:ss, its fraction dropped", () => {
    expect(entries('[{"value":"2026-05-01T10:00:00.123Z","count":1}]')).toEqual([
      ["05/01/2026 10:00:00", 1],
    ]);
    // An offset is converted to the server's time (UTC).
    expect(entries('[{"value":"2026-05-01T10:00:00+02:00","count":1}]')).toEqual([
      ["05/01/2026 08:00:00", 1],
    ]);
    // Not date-like for the old reader: kept as text.
    expect(
      entries('[{"value":"2026-05-01","count":1},{"value":"2026-05-01 10:00:00","count":1}]'),
    ).toEqual([
      ["2026-05-01", 1],
      ["2026-05-01 10:00:00", 1],
    ]);
  });

  it("writes a nested array or object in a pair as the old list and dictionary texts", () => {
    expect(
      entries('[{"value":["r1",["a","b"]],"count":1},{"value":["r2",{"c":1}],"count":1}]'),
    ).toEqual([
      ["[r1, System.Collections.Generic.List`1[System.Object]]", 1],
      ["[r2, System.Collections.Generic.Dictionary`2[System.String,System.Object]]", 1],
    ]);
  });

  it("gives each pair holding a list or object an entry of its own, as the old keys never matched", () => {
    expect(entries('[{"value":["r1",["a"]],"count":2}]')).toEqual([
      ["[r1, System.Collections.Generic.List`1[System.Object]]", 1],
      ["[r1, System.Collections.Generic.List`1[System.Object]]", 1],
    ]);
  });

  it("writes the other pair values as the old texts", () => {
    expect(
      entries(
        '[{"value":["a",true],"count":1},{"value":["b",null],"count":1},{"value":["c",1.5],"count":1},' +
          '{"value":["d","2026-05-01T10:00:00Z"],"count":1}]',
      ),
    ).toEqual([
      ["[a, True]", 1],
      ["[b, ]", 1],
      ["[c, 1.5]", 1],
      ["[d, 05/01/2026 10:00:00]", 1],
    ]);
  });

  it("walks an object (an array element) into its pairs and merges equal keys", () => {
    expect(
      entries(
        '[{"value":{"name":"a.png","type":"image/png"},"count":1},' +
          '{"value":{"name":"a.png","type":"image/gif"},"count":2}]',
      ),
    ).toEqual([
      ["[name, a.png]", 3],
      ["[type, image/png]", 1],
      ["[type, image/gif]", 2],
    ]);
  });

  it("walks a nested array into its elements", () => {
    expect(entries('[{"value":[1,2,3],"count":1},{"value":2,"count":4}]')).toEqual([
      ["1", 1],
      ["2", 5],
      ["3", 1],
    ]);
  });

  it("skips null, and keeps numbers and their text apart", () => {
    expect(
      entries(
        '[{"value":null,"count":3},{"value":1,"count":1},{"value":"1","count":2},{"value":1.5,"count":1},{"value":1.0,"count":1},{"value":1e21,"count":1}]',
      ),
    ).toEqual([
      ["1", 1],
      ["1", 2],
      ["1.5", 1],
      ["1", 1],
      ["1E+21", 1],
    ]);
  });

  it("merges date strings of the same instant, as the old DateTime keys", () => {
    expect(
      entries(
        '[{"value":"2026-05-01T10:00:00Z","count":1},{"value":"2026-05-01T10:00:00.000Z","count":2}]',
      ),
    ).toEqual([["05/01/2026 10:00:00", 3]]);
  });
});

describe("dotnetDouble: a double as the old API's invariant text", () => {
  it.each([
    [1.5, "1.5"],
    [1, "1"],
    [-2.25, "-2.25"],
    [1e21, "1E+21"],
    [1e15, "1E+15"],
    [123456789012345, "123456789012345"],
    [1234567890123456, "1234567890123456"],
    [1e16, "1E+16"],
    [0.0001, "0.0001"],
    [0.00001, "1E-05"],
    [1.5e-300, "1.5E-300"],
    [0, "0"],
  ])("%d → %s", (value, text) => {
    expect(dotnetDouble(value)).toBe(text);
  });
});

describe("oldNumberText: a JSON number as the old serializer wrote it", () => {
  it.each([
    ["1.0", "1.0"],
    ["1.5", "1.5"],
    ["3", "3"],
    ["-0", "0"],
    ["1e21", "1E+21"],
    ["1E2", "100.0"],
    ["12345678901234567890", "12345678901234567890"],
  ])("%s → %s", (text, written) => {
    expect(oldNumberText(text)).toBe(written);
  });
});

describe("oldJson: stored answers as the old results wrote them", () => {
  it("keeps 1.0 as 1.0 and writes floats as the old serializer", () => {
    expect(oldJson(parseStudioJson('{"a":1.0,"b":2,"c":[1e21,0.5],"d":true}'))).toBe(
      '{"a":1.0,"b":2,"c":[1E+21,0.5],"d":true}',
    );
  });

  it("rewrites date-like strings at any depth, keeping their kind", () => {
    expect(
      oldJson(
        parseStudioJson(
          '{"a":"2026-05-01T10:00:00.000Z","b":["2026-05-01T10:00:00.5000000"],"c":"2026-05-01T10:00:00+02:00","d":"text"}',
        ),
      ),
    ).toBe(
      '{"a":"2026-05-01T10:00:00Z","b":["2026-05-01T10:00:00.5"],"c":"2026-05-01T08:00:00+00:00","d":"text"}',
    );
  });

  it("leaves property names alone", () => {
    expect(oldJson(parseStudioJson('{"2026-05-01T10:00:00.000Z":1}'))).toBe(
      '{"2026-05-01T10:00:00.000Z":1}',
    );
  });

  it("leaves every string as stored with strings: as-stored, numbers still as the old serializer", () => {
    const value = parseStudioJson('{"a":"2026-05-01T10:00:00.000Z","b":[1.0,1e21],"c":"text"}');
    expect(oldJson(value, false, { strings: "as-stored" })).toBe(
      '{"a":"2026-05-01T10:00:00.000Z","b":[1.0,1E+21],"c":"text"}',
    );
  });

  it("writes plain numbers (a lenient parse's) as integers or old doubles", () => {
    expect(oldJson({ a: 2, b: 0.5, c: 1e21, d: -0 })).toBe('{"a":2,"b":0.5,"c":1E+21,"d":0}');
  });
});

describe("parseOldDate: the old reader's date-like strings", () => {
  it.each([
    ["2026-05-01T10:00:00", "2026-05-01T10:00:00", "unspecified"],
    ["2026-05-01T10:00:00Z", "2026-05-01T10:00:00", "utc"],
    ["2026-05-01T10:00:00z", "2026-05-01T10:00:00", "utc"],
    ["2026-05-01T10:00:00.1234567Z", "2026-05-01T10:00:00.1234567", "utc"],
    ["2026-05-01T10:00:00-0130", "2026-05-01T11:30:00", "local"],
    ["2026-05-01T10:00:00+02", "2026-05-01T08:00:00", "local"],
    ["2026-05-01T24:00:00", "2026-05-02T00:00:00", "unspecified"],
    ["2024-02-29T00:00:00", "2024-02-29T00:00:00", "unspecified"],
  ])("%s is %s (%s)", (text, wall, kind) => {
    const date = parseOldDate(text);
    expect(date).not.toBeNull();
    expect(date!.kind).toBe(kind);
    expect(oldTime(text, false)).toBe(wall);
  });

  it.each([
    "2026-05-01",
    "2026-05-01 10:00:00",
    "2026-13-01T10:00:00",
    "2025-02-29T00:00:00",
    "0000-01-01T00:00:00",
    "2026-05-01T24:00:01",
    "2026-05-01T10:60:00",
    "2026-05-01T10:00:00.",
    "2026-05-01T10:00:00.12345678Z",
    "2026-05-01T10:00:00 Z",
    "x026-05-01T10:00:00",
    `2026-05-01T10:00:00.${"1".repeat(30)}`,
  ])("%s is no date", (text) => {
    expect(parseOldDate(text)).toBeNull();
  });
});

describe("oldTime: Studio's times as the old results wrote them", () => {
  it("drops Z and trailing zeros, keeps up to 7 fractional digits", () => {
    expect(oldTime("2026-10-05T06:48:57.5172345Z", false)).toBe("2026-10-05T06:48:57.5172345");
    expect(oldTime("2026-10-05T06:48:57.120Z", false)).toBe("2026-10-05T06:48:57.12");
    expect(oldTime("2026-10-05T06:48:57.000Z", false)).toBe("2026-10-05T06:48:57");
    expect(oldTime("2026-10-05T06:48:57.123456789Z", false)).toBe("2026-10-05T06:48:57.1234567");
    expect(oldTime("2026-10-05T08:48:57+02:00", false)).toBe("2026-10-05T06:48:57");
  });

  it("keeps Z where the old API wrote UTC times", () => {
    expect(oldTime("2026-10-05T06:48:57.500Z", true)).toBe("2026-10-05T06:48:57.5Z");
  });

  it("writes no time as the old minimum", () => {
    expect(oldTime(null, false)).toBe("0001-01-01T00:00:00");
  });
});

describe("parseDateArgument: from and till as the old API parsed them", () => {
  it.each([
    ["2024-01-01", "2024-01-01T00:00:00Z"],
    [" 2024-01-01T10:20:30 ", "2024-01-01T10:20:30Z"],
    ["2024-01-01 10:20", "2024-01-01T10:20:00Z"],
    ["2024-1-2T3:04:05.1234567", "2024-01-02T03:04:05.1234567Z"],
    ["2024-01-01T00:00:00+02:00", "2023-12-31T22:00:00Z"],
    ["2024-01-01T00:00:00-0130", "2024-01-01T01:30:00Z"],
    ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"],
    ["2024/01/02", "2024-01-02T00:00:00Z"],
    ["01/02/2024", "2024-01-02T00:00:00Z"],
    ["1/2/2024 13:00:00", "2024-01-02T13:00:00Z"],
    ["Wed, 01 Apr 2026 10:00:00 GMT", "2026-04-01T10:00:00Z"],
    ["wed, 1 apr 2026 10:00 utc", "2026-04-01T10:00:00Z"],
    ["01 Apr 2026 10:00:00 GMT", "2026-04-01T10:00:00Z"],
    ["01 Apr 2026 10:00:00", "2026-04-01T10:00:00Z"],
  ])("%j → %s", (text, rfc3339) => {
    expect(parseDateArgument(text)).toBe(rfc3339);
  });

  it.each([
    "",
    "yesterday",
    "2024-13-01",
    "2024-02-30",
    "2024-01-01T25:00",
    "2024-01-01T10",
    "Tue, 01 Apr 2026 10:00:00 GMT",
    "31 Feb 2026 10:00:00 GMT",
    "01 Foo 2026 10:00:00 GMT",
  ])("%j is malformed: no bound", (text) => {
    expect(parseDateArgument(text)).toBeUndefined();
  });
});

describe("contentDisposition: the old download header", () => {
  it.each([
    ["report.pdf", "attachment; filename=report.pdf; filename*=UTF-8''report.pdf"],
    ["a b.pdf", "attachment; filename=\"a b.pdf\"; filename*=UTF-8''a%20b.pdf"],
    ["é.pdf", "attachment; filename=_.pdf; filename*=UTF-8''%C3%A9.pdf"],
    ['a"b.txt', 'attachment; filename="a\\"b.txt"; filename*=UTF-8\'\'a%22b.txt'],
    ["it's*.txt", "attachment; filename=it's*.txt; filename*=UTF-8''it%27s%2A.txt"],
  ])("%s", (name, header) => {
    expect(contentDisposition(name)).toBe(header);
  });
});

describe("linear time on adversarial input (about 1 MB)", () => {
  const mega = 1_000_000;

  it("parseDateArgument", () => {
    expectFast(() => parseDateArgument(`2024-01-01T00:00:00.${"1".repeat(mega)}x`));
    expectFast(() => parseDateArgument(`2024-01-01${" ".repeat(mega)}x`));
    expectFast(() => parseDateArgument(`${"1".repeat(mega)}`));
    expectFast(() => parseDateArgument(`1/1/2024${" ".repeat(mega)}1:00${" ".repeat(mega)}x`));
    expectFast(() => parseDateArgument(`Wed,${" ".repeat(mega)}01${" ".repeat(mega)}Apr x`));
    expectFast(() => parseDateArgument(`01 Apr 2026 10:00:00${" ".repeat(mega)}x`));
  });

  it("parseOldDate and oldTime", () => {
    expectFast(() => parseOldDate(`2026-05-01T10:00:00.${"1".repeat(mega)}`));
    expectFast(() => oldTime(`2026-05-01T10:00:00.${"1".repeat(mega)}Z`, false));
  });

  it("contentDisposition", () => {
    expectFast(() => contentDisposition(`${'é \\"'.repeat(mega / 4)}.pdf`));
  });

  it("questionResultEntries and oldJson", () => {
    // Studio writes its answers with JSON.stringify, which stops near this depth; deeper text
    // fails to parse (an empty 500), never slowly.
    const deep = `${"[".repeat(1_000)}1${"]".repeat(1_000)}`;
    expectFast(() => entries(`[{"value":${deep},"count":1}]`));
    const wide = `[${Array.from({ length: 100_000 }, (_, i) => `"2026-05-01T10:00:0${i % 10}Z"`).join(",")}]`;
    expectFast(() => entries(`[{"value":${wide},"count":1}]`));
    expectFast(() => oldJson(parseStudioJson(wide)));
  });
});
