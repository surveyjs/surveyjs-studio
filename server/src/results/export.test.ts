import { describe, expect, it } from "vitest";
import type { SurveyRecord, SurveyResponse } from "../domain/types.js";
import type { ResponsePageQuery, ResultStore } from "../providers/types.js";
import { CSV_BOM, csvColumns } from "./csv.js";
import { csvExport, jsonExport, storedResponses } from "./export.js";

const survey: SurveyRecord = {
  id: "cccccccc-0000-4000-8000-00000000000a",
  name: "Poll",
  owner: { kind: "personal", userId: "aaaaaaaa-0000-4000-8000-000000000001" },
  creatorId: null,
  postId: "dddddddd-0000-4000-8000-000000000001",
  resultId: "eeeeeeee-0000-4000-8000-000000000001",
  published: true,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

function response(index: number): SurveyResponse {
  return {
    id: `r-${index}`,
    submittedAt: "2026-04-01T10:30:00.000Z",
    data: { q: `answer ${index}` },
    partial: false,
  };
}

function responses(count: number, offset = 0): SurveyResponse[] {
  return Array.from({ length: count }, (_, index) => response(offset + index));
}

/** A store whose pages hold 1000, 1000 and 2 responses, and that records every query. */
function fakeStore(queries: ResponsePageQuery[], firstError?: Error): ResultStore {
  const pages = [
    { items: responses(1000, 0), next: { submittedAt: "p1", id: "r-999" } },
    { items: responses(1000, 1000), next: { submittedAt: "p2", id: "r-1999" } },
    { items: responses(2, 2000), next: null },
  ];
  let call = 0;
  return {
    listResponsePage: async (_survey: SurveyRecord, query: ResponsePageQuery) => {
      queries.push(query);
      if (call === 0 && firstError !== undefined) throw firstError;
      const page = pages[call++];
      if (page === undefined) throw new Error("no page left");
      return page;
    },
  } as unknown as ResultStore;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

async function collectItems<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

describe("storedResponses", () => {
  it("yields every stored response in order, a page at a time", async () => {
    const queries: ResponsePageQuery[] = [];
    const items = await collectItems(await storedResponses(fakeStore(queries), survey));
    expect(items).toHaveLength(2002);
    expect(items[0]?.id).toBe("r-0");
    expect(items[2001]?.id).toBe("r-2001");
    expect(queries).toStrictEqual([
      { limit: 1000 },
      { limit: 1000, after: { submittedAt: "p1", id: "r-999" } },
      { limit: 1000, after: { submittedAt: "p2", id: "r-1999" } },
    ]);
  });

  it("rejects when the first page fails", async () => {
    const queries: ResponsePageQuery[] = [];
    await expect(
      storedResponses(fakeStore(queries, new Error("store down")), survey),
    ).rejects.toThrow("store down");
  });
});

describe("jsonExport", () => {
  it("writes an empty array for no responses", async () => {
    expect(await collect(jsonExport(fromArray([])))).toBe("[]");
  });

  it("writes the responses as JSON items, leaving out partial and unset optional fields", async () => {
    const first = response(0);
    const second: SurveyResponse = {
      ...response(1),
      clientId: "c-1",
      respondentIp: "203.0.113.7",
      partial: true,
    };
    const parsed: unknown = JSON.parse(await collect(jsonExport(fromArray([first, second]))));
    expect(parsed).toStrictEqual([
      { id: "r-0", submittedAt: first.submittedAt, data: first.data },
      {
        id: "r-1",
        submittedAt: second.submittedAt,
        data: second.data,
        clientId: "c-1",
        respondentIp: "203.0.113.7",
      },
    ]);
  });
});

describe("csvExport", () => {
  const columns = csvColumns(
    { elements: [{ type: "text", name: "q" }] },
    { storeRespondentIp: false },
  );
  const header = "Submitted,q,ClientId\r\n";

  it("writes the BOM and the header for no responses", async () => {
    expect(await collect(csvExport(columns, fromArray([])))).toBe(CSV_BOM + header);
  });

  it("writes the BOM, the header and one record per response", async () => {
    expect(await collect(csvExport(columns, fromArray([response(0)])))).toBe(
      `${CSV_BOM}${header}2026-04-01T10:30:00.000Z,answer 0,\r\n`,
    );
  });
});
