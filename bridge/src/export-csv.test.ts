import { describe, expect, it } from "vitest";
import { JsonNumber, parseStudioJson } from "./dotnet-format.js";
import { cellText, csvExport, csvField, submittedText } from "./export-csv.js";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

describe("csvField", () => {
  it("writes a plain value as it is and nothing for none", () => {
    expect(csvField("plain text")).toBe("plain text");
    expect(csvField("")).toBe("");
    expect(csvField(null)).toBe("");
  });

  it("quotes a value with a comma, a quote or a line break, doubling its quotes (ADR 0040 point 1)", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("two\r\nlines")).toBe('"two\r\nlines"');
    expect(csvField('["a","b"]')).toBe('"[""a"",""b""]"');
  });
});

describe("cellText", () => {
  it("writes values as the old export's en-US texts", () => {
    expect(cellText(undefined)).toBe("");
    expect(cellText(null)).toBe("");
    expect(cellText("Great service")).toBe("Great service");
    expect(cellText(true)).toBe("True");
    expect(cellText(false)).toBe("False");
    expect(cellText(new JsonNumber("4"))).toBe("4");
    expect(cellText(new JsonNumber("-0"))).toBe("0");
    expect(cellText(new JsonNumber("12345678901234567890"))).toBe("12345678901234567890");
    expect(cellText(new JsonNumber("1.0"))).toBe("1");
    expect(cellText(new JsonNumber("2.5"))).toBe("2.5");
    expect(cellText(new JsonNumber("1e21"))).toBe("1E+21");
    expect(cellText(new JsonNumber("0.00001"))).toBe("1E-05");
    expect(cellText(7)).toBe("7");
  });

  it("writes a date-like answer as the en-US date and time it was read as", () => {
    expect(cellText("2026-10-05T06:48:57.517Z")).toBe("10/5/2026 6:48:57 AM");
    expect(cellText("2026-10-05T18:00:00")).toBe("10/5/2026 6:00:00 PM");
    expect(cellText("2026-01-01T00:00:00+02:00")).toBe("12/31/2025 10:00:00 PM");
    expect(cellText("2026-01-01T12:30:00Z")).toBe("1/1/2026 12:30:00 PM");
    expect(cellText("2026-10-05")).toBe("2026-10-05");
  });

  it("writes lists and objects as compact JSON, as the old serializer did", () => {
    expect(cellText(parseStudioJson('["a","b"]'))).toBe('["a","b"]');
    expect(cellText(parseStudioJson('{"r1":1.0,"at":"2026-10-05T06:48:57.000Z"}'))).toBe(
      '{"r1":1.0,"at":"2026-10-05T06:48:57Z"}',
    );
  });
});

describe("submittedText", () => {
  it("writes the time a response was submitted with the zero offset", () => {
    expect(submittedText("2026-10-05T06:48:57.517Z")).toBe("10/5/2026 6:48:57 AM +00:00");
    expect(submittedText("2026-10-05T00:05:00Z")).toBe("10/5/2026 12:05:00 AM +00:00");
  });
});

describe("csvExport", () => {
  const columns = [
    { Name: "HappendAt", DisplayName: "Submitted" },
    { Name: "IPAddress", DisplayName: "IPAddress" },
    { Name: "q1", DisplayName: "Your name, please" },
    { Name: "q1-Comment", DisplayName: "-Comment\nYour name, please" },
    { Name: "ClientId", DisplayName: "Client Id" },
  ];

  it("is the BOM alone when there are no responses: no header", () => {
    expect(csvExport(columns, [])).toEqual(BOM);
  });

  it("writes the BOM, the header and one line per response, every column included", () => {
    const body = csvExport(columns, [
      {
        submittedAt: "2026-10-06T08:00:01.120Z",
        data: parseStudioJson('{"q1":"Ann, \\"the\\" first","q1-Comment":"ok"}') as Record<
          string,
          unknown
        >,
        clientId: "client-1",
        respondentIp: "203.0.113.7",
      },
      { submittedAt: "2026-10-05T06:48:57.517Z", data: { q1: "Bob" } },
    ]);
    expect(body.subarray(0, 3)).toEqual(BOM);
    expect(body.subarray(3).toString("utf8")).toBe(
      'Submitted,IPAddress,"Your name, please","-Comment\nYour name, please",Client Id\r\n' +
        '10/6/2026 8:00:01 AM +00:00,203.0.113.7,"Ann, ""the"" first",ok,client-1\r\n' +
        "10/5/2026 6:48:57 AM +00:00,,Bob,,\r\n",
    );
  });

  it("takes an answer by its name, then by its name in lower case", () => {
    const body = csvExport(
      [{ Name: "Q", DisplayName: "Q" }],
      [{ submittedAt: "2026-10-05T06:48:57Z", data: { q: "lower" } }],
    );
    expect(body.subarray(3).toString("utf8")).toBe("Q\r\nlower\r\n");
  });

  it("writes a column without a title as empty", () => {
    const body = csvExport(
      [{ Name: "x", DisplayName: null }],
      [{ submittedAt: "2026-10-05T06:48:57Z", data: { x: 1 } }],
    );
    expect(body.subarray(3).toString("utf8")).toBe("\r\n1\r\n");
  });
});
