// Paths the bridge has no action for go to the old service unchanged (ADR 0039 point 1): here a
// stub that echoes what reached it (src/global-setup.ts), never the real old service.
import { describe, expect, it } from "vitest";
import { BASE_URL, LEGACY_STUB_URL, readAnswer } from "./harness.js";

interface Echo {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Calls the bridge and checks that the stub answered; `echo` is null for a HEAD. */
async function forwarded(path: string, init: RequestInit = {}) {
  const answer = await readAnswer(
    await fetch(`${BASE_URL}${path}`, { redirect: "manual", ...init }),
  );
  expect(answer.status).toBe(200);
  expect(answer.headers["x-legacy-stub"]).toBe("1");
  return {
    answer,
    echo: answer.body.length === 0 ? null : (JSON.parse(answer.body.toString("utf8")) as Echo),
  };
}

const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

describe.skipIf(LEGACY_STUB_URL === null)("forwarded to the old service", () => {
  it.each([
    ["the site's NPS results", "/private/Surveys/nps"],
    ["the site's NPS results with a trailing slash", "/private/v1/Surveys/getSurveyNPCResults/"],
    ["a temporary file", "/private/v1/Surveys/getTempFile?name=a%20b.png"],
    ["the public demo results", `/private/Surveys/getSurveyPublicDemoResults/${FEEDBACK}`],
    ["a scheduled job", "/private/Service/checkPQueue?key=x"],
    ["getSurvey with the ID as a path segment", `/public/Survey/getSurvey/${FEEDBACK}`],
    ["a GET of post", "/public/v1/Survey/post"],
    ["an unknown path", "/no/such/path?q=1"],
    ["the start page", "/"],
  ])("%s: GET %s", async (_what, path) => {
    const { echo } = await forwarded(path);
    expect(echo).toMatchObject({ method: "GET", url: path });
  });

  it("sends the caller's address in X-Forwarded-For", async () => {
    const { echo } = await forwarded("/private/Surveys/nps", {
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    expect(echo?.headers["x-forwarded-for"]).toMatch(/^203\.0\.113\.99, /);
  });

  it("forwards post/page-number with its method, headers and body (the old API has no such route)", async () => {
    const body = '{"postId":"x","surveyResult":"{}"}';
    const { echo } = await forwarded("/public/v1/Survey/post/page-number", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-custom": "kept" },
      body,
    });
    expect(echo).toMatchObject({ method: "POST", url: "/public/v1/Survey/post/page-number" });
    expect(echo?.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(echo?.headers["x-custom"]).toBe("kept");
    expect(Buffer.from(echo?.body ?? "", "base64").toString("utf8")).toBe(body);
  });

  it("forwards the site's temporary-file writes", async () => {
    const form = new FormData();
    form.append("file", new Blob(["temporary"], { type: "text/plain" }), "a.txt");
    const upload = await forwarded("/private/Surveys/uploadTempFiles", {
      method: "POST",
      body: form,
    });
    expect(upload.echo?.method).toBe("POST");
    expect(Buffer.from(upload.echo?.body ?? "", "base64").toString("utf8")).toContain("temporary");

    const removal = await forwarded("/private/v1/Surveys/deleteTempFile?name=a.txt", {
      method: "DELETE",
    });
    expect(removal.echo).toMatchObject({
      method: "DELETE",
      url: "/private/v1/Surveys/deleteTempFile?name=a.txt",
    });
  });

  it("forwards a HEAD of an action (the old actions answer GET only)", async () => {
    const { answer, echo } = await forwarded(`/public/Survey/getSurvey?surveyId=${FEEDBACK}`, {
      method: "HEAD",
    });
    expect(answer.body.length).toBe(0);
    expect(echo).toBeNull();
  });
});
