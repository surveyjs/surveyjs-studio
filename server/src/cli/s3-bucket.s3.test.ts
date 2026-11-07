import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createS3ByteStore } from "../bytes/s3.js";
import { s3Settings } from "../bytes/scratch-buckets.js";
import { run } from "./s3-bucket.js";

function capture() {
  let out = "";
  let err = "";
  return {
    io: { out: (text: string) => (out += text), err: (text: string) => (err += text) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("s3 bucket CLI (local S3 server)", () => {
  it("creates a bucket once, and removes it with its objects", async () => {
    const name = `cli-${randomBytes(5).toString("hex")}`;
    const first = capture();
    expect(await run(["create", name], first.io)).toBe(0);
    expect(first.out).toBe(`Created bucket ${name}.\n`);
    const again = capture();
    expect(await run(["create", name], again.io)).toBe(0);
    expect(again.out).toBe(`Bucket ${name} exists.\n`);

    const store = createS3ByteStore({ ...s3Settings(), bucket: name });
    expect(await store.probe()).toEqual({ ok: true });
    await store.put(
      `${"d".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/${"a".repeat(64)}`,
      Buffer.from("x"),
      "text/plain",
    );

    const removed = capture();
    expect(await run(["remove", name], removed.io)).toBe(0);
    expect(removed.out).toBe(`Removed bucket ${name} and 1 object.\n`);
    expect((await store.probe()).ok).toBe(false);
  });

  it("explains its usage", async () => {
    const result = capture();
    expect(await run(["drop", "x"], result.io)).toBe(2);
    expect(result.err).toContain("Usage: pnpm s3:bucket create|remove <name>");
  });
});
