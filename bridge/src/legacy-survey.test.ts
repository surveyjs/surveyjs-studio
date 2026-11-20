import type { components } from "@surveyjs-studio/contract/types";
import { describe, expect, it } from "vitest";
import { legacySurvey, netHtmlEncode } from "./legacy-survey.js";

type Survey = components["schemas"]["Survey"];

const CALLER = "3c4a7fdf-94a1-41ec-96d0-41749c260100";
const PROJECT = "56ddd87e-e091-47cd-8edb-4843ee17829c";

const SURVEY: Survey = {
  id: "f6f1c966-8d49-46d0-94d3-975c53b6577d",
  name: "NPS",
  projectId: null,
  published: true,
  archived: false,
  createdAt: "2025-01-02T03:04:05.110Z",
  updatedAt: "2026-11-19T10:00:00.127Z",
  postId: "13f2e886-9c38-42f2-b814-d0900cf06a19",
  resultId: "929d229c-9f78-40ec-aa47-0eea718a53b2",
  permissions: { canModify: true },
  useCookies: false,
  creatorId: CALLER,
  legacyPublishId: null,
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

describe("legacySurvey", () => {
  it("writes the 16 fields in the old order, list dates with Z", () => {
    expect(JSON.stringify(legacySurvey(SURVEY, "list", CALLER))).toBe(
      `{"Name":"NPS","IsArchived":false,"UserId":"${CALLER}",` +
        `"CreatorId":"${CALLER}","PostId":"13f2e886-9c38-42f2-b814-d0900cf06a19",` +
        `"ResultId":"929d229c-9f78-40ec-aa47-0eea718a53b2","PublishId":null,` +
        `"IsPublished":true,"UseCookies":false,"UpdatedOn":"2026-11-19T10:00:00.127Z",` +
        `"CreatedAt":"2025-01-02T03:04:05.11Z","AllowAccessResult":false,` +
        `"StoreIPAddress":false,"Theme":null,"Json":null,` +
        `"Id":"f6f1c966-8d49-46d0-94d3-975c53b6577d"}`,
    );
  });

  it("writes single-read dates without Z", () => {
    const record = legacySurvey(SURVEY, "single", CALLER);
    expect(record.UpdatedOn).toBe("2026-11-19T10:00:00.127");
    expect(record.CreatedAt).toBe("2025-01-02T03:04:05.11");
  });

  it("names a project survey's owner by the project, and maps the rest of the record", () => {
    const record = legacySurvey(
      {
        ...SURVEY,
        projectId: PROJECT,
        archived: true,
        published: false,
        useCookies: true,
        creatorId: null,
        legacyPublishId: "0A0B0C0D-0000-4000-8000-000000000001",
        theme: { themeName: "flat", cssVariables: { "--a": 1 } },
        settings: { publicResults: true, storeRespondentIp: true, useCookies: true },
      },
      "list",
      CALLER,
    );
    expect(record).toMatchObject({
      IsArchived: true,
      UserId: PROJECT,
      CreatorId: "00000000-0000-0000-0000-000000000000",
      PublishId: "0a0b0c0d-0000-4000-8000-000000000001",
      IsPublished: false,
      UseCookies: true,
      AllowAccessResult: true,
      StoreIPAddress: true,
      Theme: '{"themeName":"flat","cssVariables":{"--a":1}}',
      Json: null,
    });
  });

  it("writes an empty theme as no theme", () => {
    expect(legacySurvey({ ...SURVEY, theme: {} }, "list", CALLER).Theme).toBeNull();
    expect(legacySurvey({ ...SURVEY, theme: null }, "list", CALLER).Theme).toBeNull();
  });
});

describe("netHtmlEncode", () => {
  it("encodes the five HTML characters, Latin-1 and astral characters as the old encoder", () => {
    expect(netHtmlEncode(`{"a":"<b>&'"}`)).toBe("{&quot;a&quot;:&quot;&lt;b&gt;&amp;&#39;&quot;}");
    expect(netHtmlEncode(`${String.fromCharCode(0xa0)}éÿĀж`)).toBe("&#160;&#233;&#255;Āж");
    expect(netHtmlEncode("x😀y")).toBe("x&#128512;y");
    const replacement = String.fromCharCode(0xfffd);
    expect(netHtmlEncode("a\uD800b\uDC00")).toBe(`a${replacement}b${replacement}`);
    expect(netHtmlEncode("plain text\n")).toBe("plain text\n");
  });
});
