import { describe, expect, it } from "vitest";
import {
  calculateColumns,
  ColumnsRefused,
  localeOf,
  newestFirst,
  resultColumns,
} from "./columns.js";
import { parseStudioJson } from "./dotnet-format.js";

const ZERO = "00000000-0000-0000-0000-000000000000";

/** A column as the old answer wrote it. */
const column = (
  Name: string,
  DisplayName: string | null,
  fields: { DataType?: number; Visibility?: number; Location?: number } = {},
) => ({
  Name,
  DisplayName,
  DataType: fields.DataType ?? 0,
  Visibility: fields.Visibility ?? 0,
  Location: fields.Location ?? 0,
  Id: ZERO,
});

const DEFINITION = parseStudioJson(
  JSON.stringify({
    pages: [
      {
        name: "page1",
        elements: [
          { type: "text", name: "q1", title: "Your name" },
          { type: "comment", name: "q2" },
          {
            type: "panel",
            name: "panel1",
            elements: [
              { type: "text", name: "q3", title: { default: "Hello", de: "Hallo", fr: "Bonjour" } },
            ],
          },
        ],
      },
    ],
  }),
);

const ROWS = [
  // Newest first.
  { data: { q2: "two", extra: 1, q1: "Ann" }, clientId: "client-1" },
  { data: { q3: "three", "q1-Comment": "note", id: "x" } },
];

const base = {
  definition: DEFINITION,
  rows: ROWS,
  columnsLayout: null,
  privateQuestions: [] as string[],
  locale: "de" as string | null,
  storeIp: true,
};

describe("calculateColumns", () => {
  it("puts Submitted and the IP first, then each answer by its question's place, unknown names first", () => {
    expect(calculateColumns(base)).toEqual([
      column("HappendAt", "Submitted"),
      column("IPAddress", "IPAddress", { Visibility: 2 }),
      column("ClientId", "Client Id", { Visibility: 2 }),
      column("extra", "extra"),
      column("q1", "Your name"),
      column("q1-Comment", "-Comment\nYour name"),
      column("q2", "q2"),
      column("q3", "Hallo"),
    ]);
  });

  it("leaves out the IP column when the survey does not store IPs, and a client column without client IDs", () => {
    const names = calculateColumns({
      ...base,
      storeIp: false,
      rows: [{ data: { q1: "Ann" } }],
    }).map((c) => c.Name);
    expect(names).toEqual(["HappendAt", "q1"]);
  });

  it("takes a title in the locale, else its first text; no locale takes the first text", () => {
    const title = (locale: string | null) =>
      calculateColumns({ ...base, locale }).find((c) => c.Name === "q3")!.DisplayName;
    expect(title("fr")).toBe("Bonjour");
    expect(title("en")).toBe("Hello");
    expect(title("default")).toBe("Hello");
    expect(title(null)).toBe("Hello");
  });

  it("writes a title that is no text as the old platform's text of it", () => {
    const definition = parseStudioJson(
      '{"elements":[{"name":"n","title":5},{"name":"b","title":true}]}',
    );
    const columns = calculateColumns({
      ...base,
      definition,
      rows: [{ data: { n: 1, b: 2 } }],
    });
    expect(columns.slice(2).map((c) => c.DisplayName)).toEqual(["5", "True"]);
  });

  it("uses the survey's commentPrefix as the comment suffix", () => {
    const definition = parseStudioJson(
      '{"commentPrefix":"-other","elements":[{"name":"q","title":"Q"},{"name":"r"}]}',
    );
    const columns = calculateColumns({
      ...base,
      storeIp: false,
      definition,
      rows: [{ data: { r: 1, "q-other": "x", q: "y" } }],
    });
    expect(columns).toEqual([
      column("HappendAt", "Submitted"),
      column("q-other", "-other\nQ"),
      column("q", "Q"),
      column("r", "r"),
    ]);
  });

  it("marks file and image answers by their link prefix, as rows", () => {
    const columns = calculateColumns({
      ...base,
      storeIp: false,
      rows: [{ data: { q1: "dxsfile:a/b.pdf", q2: "dxsimage:c.png" } }],
    });
    expect(columns.slice(1)).toEqual([
      column("q1", "Your name", { DataType: 1, Location: 1 }),
      column("q2", "q2", { DataType: 2, Location: 1 }),
    ]);
  });

  it("puts the shared columns layout's columns first, in its order, and the new ones after it", () => {
    const columnsLayout = JSON.stringify({
      columns: [
        { name: "q2", displayname: "Second", visibility: 1 },
        { name: "gone" },
        { name: "q1", location: 1 },
        { name: "HappendAt", visibility: "1" },
        // The old read took a text as a number, and any other text as the default.
        { name: "q3", visibility: "Invisible" },
      ],
      newcolumnsvisibility: 1,
    });
    expect(
      calculateColumns({
        ...base,
        storeIp: false,
        rows: [{ data: { q1: "dxsfile:x", q2: "b", q3: "c" } }],
        columnsLayout,
        privateQuestions: ["q1"],
      }),
    ).toEqual([
      column("q2", "Second", { Visibility: 1 }),
      // Private: not visible in public reads; a stored column loses its data type.
      column("q1", "Your name", { Visibility: 2, Location: 1 }),
      column("HappendAt", "Submitted", { Visibility: 1 }),
      column("q3", "Hallo"),
    ]);
  });

  it("gives the layout's visibility for new columns to the visible columns it does not hold", () => {
    const columnsLayout = '{"columns":[{"name":"q2"}],"newcolumnsvisibility":"2"}';
    expect(
      calculateColumns({
        ...base,
        storeIp: true,
        rows: [{ data: { q2: "b", q3: "dxsimage:c" } }],
        columnsLayout,
      }),
    ).toEqual([
      column("q2", "q2"),
      column("HappendAt", "Submitted", { Visibility: 2 }),
      column("IPAddress", "IPAddress", { Visibility: 2 }),
      // A copied column loses its data type, not its place.
      column("q3", "Hallo", { Visibility: 2, Location: 1 }),
    ]);
  });

  it("changes nothing for an empty layout or one without columns", () => {
    const plain = calculateColumns(base);
    expect(calculateColumns({ ...base, columnsLayout: "" })).toEqual(plain);
    expect(calculateColumns({ ...base, columnsLayout: '{"columns":[]}' })).toEqual(plain);
    expect(calculateColumns({ ...base, columnsLayout: "{}" })).toEqual(plain);
  });

  it("reads the layout as the old reader did: lenient JSON", () => {
    const columns = calculateColumns({
      ...base,
      columnsLayout: "{columns:[{'name':'q2',},],}",
    });
    expect(columns[0]!.Name).toBe("q2");
  });

  it("refuses what the old calculation failed on", () => {
    for (const columnsLayout of [
      "[1]",
      "null",
      "not json",
      '{"columns":"abc"}',
      '{"columns":{"name":"q1"}}',
      '{"columns":[1]}',
      '{"columns":[],"newcolumnsvisibility":true}',
      '{"columns":[],"newcolumnsvisibility":1.5}',
      '{"columns":[{"name":"q1","visibility":true}]}',
    ]) {
      expect(() => calculateColumns({ ...base, columnsLayout }), columnsLayout).toThrow(
        ColumnsRefused,
      );
    }
    expect(() => calculateColumns({ ...base, definition: [] })).toThrow(ColumnsRefused);
    expect(() =>
      calculateColumns({
        ...base,
        definition: parseStudioJson('{"elements":[{"name":"q1","title":{}}]}'),
      }),
    ).toThrow(ColumnsRefused);
  });
});

describe("newestFirst", () => {
  it("orders responses by the time they were submitted, newest first", () => {
    const rows = [
      { submittedAt: "2026-10-05T06:48:57.517Z", n: 1 },
      { submittedAt: "2026-10-07T00:00:00Z", n: 2 },
      { submittedAt: "2026-10-06T00:00:00.000Z", n: 3 },
    ];
    expect(newestFirst(rows).map((row) => row.n)).toEqual([2, 3, 1]);
  });
});

describe("resultColumns", () => {
  it("answers { Columns, Id } from every response, newest first", async () => {
    async function* responses() {
      yield { id: "a", submittedAt: "2026-10-05T00:00:00Z", data: { q2: 1 } };
      yield { id: "b", submittedAt: "2026-10-06T00:00:00Z", data: { extra: 1 }, clientId: "c" };
    }
    expect(
      await resultColumns({
        definition: DEFINITION as object,
        responses: responses(),
        columnsLayout: null,
        privateQuestions: [],
        locale: "default",
        storeIp: false,
      }),
    ).toEqual({
      Columns: [
        column("HappendAt", "Submitted"),
        column("ClientId", "Client Id", { Visibility: 2 }),
        column("extra", "extra"),
        column("q2", "q2"),
      ],
      Id: ZERO,
    });
  });
});

describe("localeOf", () => {
  it("takes the language of the first Accept-Language entry, lower case", () => {
    expect(localeOf("de-DE")).toBe("de");
    expect(localeOf("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(localeOf("EN-us, fr")).toBe("en");
    expect(localeOf("zh-Hans")).toBe("zh");
    expect(localeOf("fil-PH")).toBe("fil");
    expect(localeOf("fr")).toBe("fr");
  });

  it("is default without the header or with an empty first entry", () => {
    expect(localeOf(undefined)).toBe("default");
    expect(localeOf("")).toBe("default");
    expect(localeOf(",de")).toBe("default");
  });

  it("is bad for a first entry the old code could not read as a culture name", () => {
    for (const header of ["en;q=0.9", "*", "en_US", "en-US ,de", "e", "de-"]) {
      expect(localeOf(header), header).toBe("bad");
    }
  });
});
