/**
 * Empty buckets for tests on the local S3 server (`pnpm s3:up`; settings in docker/s3.env, which
 * the providers-s3 test project reads).
 */
import { randomBytes } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3Settings } from "./s3.js";

/** The local S3 server's settings from the environment, without a bucket. */
export function s3Settings(): Omit<S3Settings, "bucket"> {
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 tests need S3_ENDPOINT and the S3 keys (see docker/s3.env)");
  }
  return {
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  };
}

export interface ScratchBucket {
  readonly name: string;
  /** Deletes every object and the bucket. */
  remove(): Promise<void>;
}

export async function scratchBucket(): Promise<ScratchBucket> {
  const settings = s3Settings();
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint!,
    forcePathStyle: true,
    credentials: settings.credentials!,
  });
  const name = `test-${randomBytes(6).toString("hex")}`;
  await client.send(new CreateBucketCommand({ Bucket: name }));
  return {
    name,
    async remove() {
      for (;;) {
        const listed = await client.send(new ListObjectsV2Command({ Bucket: name }));
        const keys = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length === 0) break;
        await client.send(new DeleteObjectsCommand({ Bucket: name, Delete: { Objects: keys } }));
      }
      await client.send(new DeleteBucketCommand({ Bucket: name }));
      client.destroy();
    },
  };
}
