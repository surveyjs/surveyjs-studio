import { pathToFileURL } from "node:url";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { describeUnexpected, type CliIo } from "./common.js";

export const USAGE = `Usage: pnpm s3:bucket create|remove <name>

For development and tests on the local S3 server (pnpm s3:up): creates a bucket (fine when it
exists), or removes one with every object in it. Reads S3_ENDPOINT, S3_REGION and the S3 keys
from the environment (docker/s3.env). The app itself never creates or removes a bucket.

Exit codes: 0 success, 1 S3 error, 2 usage error`;

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function clientFromEnv(env: NodeJS.ProcessEnv): S3Client {
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  return new S3Client({
    region: env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    ...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
    ...(S3_ACCESS_KEY_ID &&
      S3_SECRET_ACCESS_KEY && {
        credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
      }),
  });
}

async function exists(client: S3Client, Bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket }));
    return true;
  } catch {
    return false;
  }
}

/** Runs `create` or `remove`. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const [command, name, ...rest] = argv.filter((arg) => arg !== "--");
  if ((command !== "create" && command !== "remove") || !name || rest.length > 0) {
    io.err(`${USAGE}\n`);
    return 2;
  }
  if (!BUCKET_NAME.test(name)) {
    io.err(`Not a bucket name: ${name}\n\n${USAGE}\n`);
    return 2;
  }
  const client = clientFromEnv(env);
  try {
    if (command === "create") {
      if (await exists(client, name)) {
        io.out(`Bucket ${name} exists.\n`);
        return 0;
      }
      await client.send(new CreateBucketCommand({ Bucket: name }));
      io.out(`Created bucket ${name}.\n`);
      return 0;
    }
    let count = 0;
    for (;;) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: name }));
      const keys = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length === 0) break;
      await client.send(new DeleteObjectsCommand({ Bucket: name, Delete: { Objects: keys } }));
      count += keys.length;
    }
    await client.send(new DeleteBucketCommand({ Bucket: name }));
    io.out(`Removed bucket ${name} and ${count} object${count === 1 ? "" : "s"}.\n`);
    return 0;
  } catch (error) {
    io.err(`Error: ${describeUnexpected(error)}\n`);
    return 1;
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
