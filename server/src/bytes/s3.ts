import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { checkKey, type ByteStore } from "./types.js";

/** FILE_STORE=s3 (config `files` of kind `s3`). */
export interface S3Settings {
  readonly bucket: string;
  readonly region: string;
  /** null: AWS S3 itself. */
  readonly endpoint: string | null;
  readonly forcePathStyle: boolean;
  /** null: the AWS SDK's default credential chain. */
  readonly credentials: { readonly accessKeyId: string; readonly secretAccessKey: string } | null;
}

/** How long a call waits for the server (tests use less). */
export interface S3Timeouts {
  /** To open a connection; default 3 s. */
  readonly connectionTimeoutMs: number;
  /** With no data on an open connection; default 30 s. A long download that keeps flowing is fine. */
  readonly idleTimeoutMs: number;
}

const DEFAULT_TIMEOUTS: S3Timeouts = { connectionTimeoutMs: 3000, idleTimeoutMs: 30_000 };

/** DeleteObjects takes at most this many keys. */
const DELETE_BATCH = 1000;

/** A safe category for a failed S3 call: the error's name or HTTP status, never its message. */
function reasonOf(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string" && /^[A-Za-z0-9]+$/.test(name) && name !== "Error") return name;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return typeof status === "number" ? String(status) : "unknown";
}

const isMissing = (error: unknown): boolean =>
  (error as { name?: unknown }).name === "NoSuchKey" ||
  (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode === 404;

/**
 * File bytes in an S3-compatible bucket (AWS S3, RustFS, Cloudflare R2, Backblaze B2), under the
 * key `{survey id}/{file id}`. The SDK's newer request and response checksums are only used where
 * an operation requires them: several S3-compatible services refuse the new headers. Calls give up
 * after `timeouts` instead of waiting on a server that does not answer.
 */
export function createS3ByteStore(
  settings: S3Settings,
  timeouts: S3Timeouts = DEFAULT_TIMEOUTS,
): ByteStore {
  const client = new S3Client({
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    ...(settings.endpoint !== null && { endpoint: settings.endpoint }),
    ...(settings.credentials !== null && { credentials: { ...settings.credentials } }),
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // Without these a server that drops packets keeps every call (and readiness) waiting for
    // minutes: the SDK sets no connection timeout and retries.
    // (`requestTimeout` would cap a whole download, and only warns unless told to throw.)
    requestHandler: {
      connectionTimeout: timeouts.connectionTimeoutMs,
      socketTimeout: timeouts.idleTimeoutMs,
    },
  });
  const Bucket = settings.bucket;

  return {
    put: async (key, content, contentType) => {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: checkKey(key),
          Body: content,
          ContentType: contentType,
          ContentLength: content.length,
        }),
      );
    },
    get: async (key) => {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket, Key: checkKey(key) }));
        return (response.Body as Readable | undefined) ?? null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    delete: async (keys) => {
      const checked = keys.map(checkKey);
      for (let start = 0; start < checked.length; start += DELETE_BATCH) {
        const objects = checked.slice(start, start + DELETE_BATCH).map((Key) => ({ Key }));
        const response = await client.send(
          new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }),
        );
        if (response.Errors && response.Errors.length > 0) {
          throw new Error(`S3 did not delete ${String(response.Errors.length)} objects`);
        }
      }
    },
    copy: async (fromKey, toKey) => {
      const source = checkKey(fromKey);
      await client.send(
        new CopyObjectCommand({ Bucket, CopySource: `${Bucket}/${source}`, Key: checkKey(toKey) }),
      );
    },
    probe: async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
    },
  };
}
