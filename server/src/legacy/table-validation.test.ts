import { describe, expect, it } from "vitest";
import type { LegacyTable } from "../providers/azure-legacy/fixtures.js";
import { validateFixtureTables } from "./table-validation.js";

const GUID = "66666666-0000-4000-8000-a00000000001";

const goodPost = {
  PartitionKey: "*",
  RowKey: GUID,
  "id@odata.type": "Edm.Guid",
  id: GUID,
  "happendat@odata.type": "Edm.DateTime",
  happendat: "2026-04-01T08:00:00Z",
  "surveyid@odata.type": "Edm.Guid",
  surveyid: GUID,
  "postid@odata.type": "Edm.Guid",
  postid: GUID,
  result: "{}",
};

const table = (
  name: string,
  entities: LegacyTable["entities"],
  account = "results",
): LegacyTable => ({
  account,
  name,
  entities,
});

describe("validateFixtureTables", () => {
  it("accepts a correctly annotated post table", () => {
    expect(validateFixtureTables([table("post3333", [goodPost])])).toEqual([]);
  });

  it("rejects an unknown or misspelled Edm type, naming file, row and property", () => {
    const bad = { ...goodPost, "happendat@odata.type": "Edm.Datetime" };
    const problems = validateFixtureTables([table("post3333", [goodPost, bad])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tables/results/post3333.json");
    expect(problems[0]).toContain("row 1");
    expect(problems[0]).toContain("happendat");
    expect(problems[0]).toContain("Edm.Datetime");
  });

  it.each(["id", "postid", "surveyid"])("requires %s to be Edm.Guid on post tables", (property) => {
    const bad: LegacyTable["entities"][number] = { ...goodPost };
    delete bad[`${property}@odata.type`];
    const problems = validateFixtureTables([table("post3333", [bad])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(property);
    expect(problems[0]).toContain("Edm.Guid");
  });

  it("requires happendat to be Edm.DateTime and instanceid Edm.Guid on postdelete tables", () => {
    const entity: LegacyTable["entities"][number] = { ...goodPost, instanceid: GUID };
    delete entity["happendat@odata.type"];
    const problems = validateFixtureTables([table("postdelete3333", [entity])]);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("happendat");
    expect(problems.join("\n")).toContain("instanceid");
  });

  it("checks the surveys log, including optional GUID payload members when present", () => {
    const event = {
      PartitionKey: "*",
      RowKey: GUID,
      "id@odata.type": "Edm.Guid",
      id: GUID,
      "happendat@odata.type": "Edm.DateTime",
      happendat: "2026-04-01T08:00:00Z",
      "surveyid@odata.type": "Edm.Guid",
      surveyid: GUID,
      userid: GUID,
    };
    const problems = validateFixtureTables([table("surveys", [event], "surveys")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("userid");
  });

  it("does not require annotations on SurveyCompletion rows", () => {
    const row = { PartitionKey: "*", RowKey: "client-0001", ispartialcompleted: true };
    expect(validateFixtureTables([table("SurveyCompletion3333", [row])])).toEqual([]);
  });

  it.each([
    ["Edm.Boolean", "ispartialcompleted", "false"],
    ["Edm.Guid", "id", "not-a-guid"],
    ["Edm.Guid", "id", 5],
    ["Edm.DateTime", "happendat", "yesterday"],
    ["Edm.Int64", "count", 5],
  ])("rejects a value that does not fit %s (%s = %j)", (type, property, value) => {
    const entity = { ...goodPost, [`${property}@odata.type`]: type, [property]: value };
    const problems = validateFixtureTables([table("post3333", [entity])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`property "${property}"`);
  });

  it("accepts a real boolean and an Int64 string", () => {
    const entity = {
      ...goodPost,
      "ispartialcompleted@odata.type": "Edm.Boolean",
      ispartialcompleted: false,
      "count@odata.type": "Edm.Int64",
      count: "12",
    };
    expect(validateFixtureTables([table("post3333", [entity])])).toEqual([]);
  });
});
