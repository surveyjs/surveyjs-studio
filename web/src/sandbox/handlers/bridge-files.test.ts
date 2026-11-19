// uploadResponseFileByPostId (ADR 0039 point 2) in the sandbox.
import { describe, expect, it } from "vitest";
import { ORIGIN, setupSandbox, SURVEYS } from "./testing";

function form(size: number, name = "dot.png", field = "file"): FormData {
  const data = new FormData();
  data.append(field, new Blob([new Uint8Array(size).fill(7) as BlobPart]), name);
  return data;
}

const upload = (path: string, body: FormData) =>
  fetch(new Request(`${ORIGIN}/api/v1${path}`, { method: "POST", body }));

const byPost = (postId: string) => `/public/posts/${postId}/files`;
const OLD_POLL_POST = "33333333-0000-4000-8000-a00000000003";

describe("uploadResponseFileByPostId", () => {
  it("stores a file for an unpublished survey and serves it; 404 for an unknown post ID", async () => {
    const { call } = setupSandbox({}, "hosted");
    // The survey's own route refuses an unpublished survey.
    expect((await upload(`/public/surveys/${SURVEYS.oldPoll}/files`, form(10))).status).toBe(404);
    const response = await upload(byPost(OLD_POLL_POST), form(10));
    expect(response.status).toBe(201);
    const stored = (await response.json()) as { id: string };
    expect(stored).toMatchObject({ name: "dot.png", contentType: "image/png", size: 10 });
    expect(response.headers.get("location")).toBe(`/api/v1/public/files/${stored.id}`);
    expect((await call(`/public/files/${stored.id}`)).status).toBe(200);

    const unknown = await upload(byPost("nope"), form(10));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "survey-not-available" });
  });

  it("answers 422 for another field and 400 for a long post ID", async () => {
    setupSandbox({}, "hosted");
    expect((await upload(byPost(OLD_POLL_POST), form(10, "a.png", "other"))).status).toBe(422);
    expect((await upload(byPost("p".repeat(201)), form(10))).status).toBe(400);
  });
});

describe("outside the hosted edition (the sandbox's own)", () => {
  it("answers 404 not-found for every operation for the old service's surveys, as an unknown path", async () => {
    const { call } = setupSandbox();
    const config = await call("/config");
    expect(((await config.json()) as { edition: string }).edition).toBe("self-hosted");
    const answers = [
      await call(`/public/surveys/${SURVEYS.oldPoll}/definition`),
      await call(`/public/surveys/${SURVEYS.oldPoll}/respondents/c`),
      await call(`/public/results/44444444-0000-4000-8000-a00000000003/respondents/c`),
      await call(`/public/results/44444444-0000-4000-8000-a00000000003/questions/q1`),
      await call(`/public/posts/${OLD_POLL_POST}/responses`, {
        method: "POST",
        json: { data: { q1: "a" } },
      }),
      await upload(byPost(OLD_POLL_POST), form(10)),
      await call("/public/legacy-files/asset/a.png"),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toMatchObject({ code: "not-found", status: 404 });
    }
  });

  it("names the hosted edition in /config when configured so", async () => {
    const { call } = setupSandbox({}, "hosted");
    const config = await call("/config");
    expect(((await config.json()) as { edition: string }).edition).toBe("hosted");
  });
});
