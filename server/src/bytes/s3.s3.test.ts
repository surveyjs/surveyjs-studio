import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { describeByteStoreSuite, newKey } from "./byte-store-suite.js";
import { createS3ByteStore } from "./s3.js";
import { scratchBucket, s3Settings } from "./scratch-buckets.js";

describeByteStoreSuite("S3 (the local S3 server)", async () => {
  const bucket = await scratchBucket();
  return {
    store: createS3ByteStore({ ...s3Settings(), bucket: bucket.name }),
    remove: bucket.remove,
  };
});

describe("S3 byte store", () => {
  it("reports a bucket it cannot reach with a code, never a message", async () => {
    const store = createS3ByteStore({ ...s3Settings(), bucket: "surveyjs-studio-missing-bucket" });
    const probe = await store.probe();
    expect(probe.ok).toBe(false);
    expect(probe.reason).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("is what FILE_STORE=s3 opens, from the settings", async () => {
    const bucket = await scratchBucket();
    try {
      const config = loadConfig({
        IDENTITY_PROVIDER: "dev",
        STORAGE_PROVIDER: "sqlite",
        FILE_STORE: "s3",
        S3_BUCKET: bucket.name,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_FORCE_PATH_STYLE: "true",
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      });
      if (config.files?.kind !== "s3") throw new Error("unreachable");
      const store = createS3ByteStore(config.files);
      const key = newKey();
      await store.put(key, Buffer.from("via settings"), "text/plain");
      expect(await store.get(key)).not.toBeNull();
    } finally {
      await bucket.remove();
    }
  });
});
