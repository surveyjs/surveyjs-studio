import { describe, expect, it } from "vitest";
import { BODY_LIMITS, readJson } from "./common";
import { ProblemError } from "./problems";

const post = (body: string, contentType = "application/json") =>
  new Request("http://localhost/api/v1/x", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

/** The Problem `readJson` throws, or null when it reads the body. */
async function problemOf(request: Request, maxBytes?: number) {
  try {
    await readJson(request, ["application/json"], maxBytes);
    return null;
  } catch (error) {
    if (error instanceof ProblemError) return error.init;
    throw error;
  }
}

describe("readJson", () => {
  it("counts the body's UTF-8 bytes against the limit, as the server's body limit does", async () => {
    // Four characters, six bytes.
    expect(await problemOf(post('"éé"'), 6)).toBeNull();
    expect(await problemOf(post('"éé"'), 5)).toMatchObject({
      code: "payload-too-large",
      status: 413,
    });
  });

  it("refuses a body over limits.maxResponseBytes by default", async () => {
    const body = `"${"x".repeat(BODY_LIMITS.maxResponseBytes - 1)}"`;
    expect(await problemOf(post(body))).toMatchObject({ status: 413 });
    expect(await problemOf(post(body.slice(1)))).toMatchObject({ status: 400 });
  });
});
