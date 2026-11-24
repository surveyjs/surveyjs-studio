import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook, webhookSignature, type WebhookMessage } from "./webhook.js";
import { webhookKey } from "./webhook-secret.js";

// The Standard Webhooks test vector (standardwebhooks.com).
const KEY = webhookKey("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
const TIMESTAMP = 1614265330;
const NOW_MS = TIMESTAMP * 1000;
const VECTOR: WebhookMessage = {
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: String(TIMESTAMP),
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  body: '{"test": 2432232314}',
};

describe("verifyWebhook", () => {
  it("accepts the Standard Webhooks test vector", () => {
    expect(verifyWebhook(VECTOR, KEY, NOW_MS)).toBe("valid");
  });

  it("accepts a list whose matching signature comes after a wrong one", () => {
    const signature = `v1,${Buffer.alloc(32, 7).toString("base64")} ${VECTOR.signature}`;
    expect(verifyWebhook({ ...VECTOR, signature }, KEY, NOW_MS)).toBe("valid");
  });

  it("ignores signatures of another version", () => {
    const signature = VECTOR.signature!.replace("v1,", "v2,");
    expect(verifyWebhook({ ...VECTOR, signature }, KEY, NOW_MS)).toBe("bad-signature");
  });

  it("refuses a body with one byte changed", () => {
    const body = VECTOR.body.replace("2432232314", "2432232315");
    expect(verifyWebhook({ ...VECTOR, body }, KEY, NOW_MS)).toBe("bad-signature");
  });

  it.each(["id", "timestamp", "signature"] as const)("reports a missing %s", (header) => {
    expect(verifyWebhook({ ...VECTOR, [header]: undefined }, KEY, NOW_MS)).toBe("missing");
  });

  it.each([
    ["301 s after", NOW_MS + 301_000],
    ["301 s before", NOW_MS - 301_000],
  ])("refuses a timestamp the clock is %s", (_name, nowMs) => {
    expect(verifyWebhook(VECTOR, KEY, nowMs)).toBe("stale");
  });

  it.each([
    ["300 s after", NOW_MS + 300_000],
    ["300 s before", NOW_MS - 300_000],
  ])("accepts a timestamp the clock is %s", (_name, nowMs) => {
    expect(verifyWebhook(VECTOR, KEY, nowMs)).toBe("valid");
  });

  it("treats a timestamp that is not a number as stale", () => {
    expect(verifyWebhook({ ...VECTOR, timestamp: "12abc" }, KEY, NOW_MS)).toBe("stale");
  });

  it("refuses a signature of another length without throwing", () => {
    const signature = `v1,${Buffer.alloc(16, 1).toString("base64")}`;
    expect(verifyWebhook({ ...VECTOR, signature }, KEY, NOW_MS)).toBe("bad-signature");
  });
});

describe("signWebhook", () => {
  it("gives headers that verify", () => {
    const body = '{"type":"account.deleted","data":{"userId":"x"}}';
    const headers = signWebhook(KEY, "msg_1", TIMESTAMP, body);
    expect(Object.keys(headers).sort()).toEqual([
      "webhook-id",
      "webhook-signature",
      "webhook-timestamp",
    ]);
    const message: WebhookMessage = {
      id: headers["webhook-id"],
      timestamp: headers["webhook-timestamp"],
      signature: headers["webhook-signature"],
      body,
    };
    expect(verifyWebhook(message, KEY, NOW_MS)).toBe("valid");
  });

  it("signs the test vector as Standard Webhooks does", () => {
    expect(signWebhook(KEY, VECTOR.id!, TIMESTAMP, VECTOR.body)["webhook-signature"]).toBe(
      VECTOR.signature,
    );
  });
});

describe("webhookSignature", () => {
  // The account-deleted vector given to the surveyjs.io team (synthetic secret and id): it pins
  // the exact format the site must produce.
  const SECRET = "whsec_c3R1ZGlvLXN0ZXAyLXRlc3Qta2V5LTAxMjM0NTY3ODk=";
  const BODY =
    '{"type":"account.deleted","data":{"userId":"11111111-0000-4000-8000-000000000042"}}';
  const SIGNATURE = "g8PHZrYFnISHwtkQ3U90WypS8bDWX0ypJmjcbOBnccs=";

  it("signs the account-deleted vector", () => {
    expect(webhookSignature(webhookKey(SECRET), "msg_0001", "1767225600", BODY)).toBe(SIGNATURE);
    expect(signWebhook(webhookKey(SECRET), "msg_0001", 1767225600, BODY)).toEqual({
      "webhook-id": "msg_0001",
      "webhook-timestamp": "1767225600",
      "webhook-signature": `v1,${SIGNATURE}`,
    });
  });
});
