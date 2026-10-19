import { describe, expect, it } from "vitest";
import { isWebhookSecret, webhookKey } from "./webhook-secret.js";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

describe("isWebhookSecret", () => {
  it("accepts whsec_ and the base64 of 24 bytes", () => {
    expect(isWebhookSecret(SECRET)).toBe(true);
  });

  it("refuses fewer than 24 bytes", () => {
    expect(isWebhookSecret(`whsec_${Buffer.alloc(23, 1).toString("base64")}`)).toBe(false);
  });

  it("refuses base64 without the prefix", () => {
    expect(isWebhookSecret(Buffer.alloc(24, 1).toString("base64"))).toBe(false);
  });

  it("refuses text that is not base64", () => {
    expect(isWebhookSecret("whsec_not base64!")).toBe(false);
  });

  it("refuses base64 whose length is not a multiple of 4", () => {
    expect(isWebhookSecret(SECRET.slice(0, -1))).toBe(false);
  });
});

describe("webhookKey", () => {
  it("gives the 24 decoded bytes", () => {
    const key = webhookKey(SECRET);
    expect(key).toHaveLength(24);
    expect(key.equals(Buffer.from(SECRET.slice("whsec_".length), "base64"))).toBe(true);
  });

  it("throws a message without the value", () => {
    expect(() => webhookKey("whsec_short")).toThrow(/ACCOUNT_WEBHOOK_SECRET/);
    expect(() => webhookKey("whsec_short")).not.toThrow(/short/);
  });
});
