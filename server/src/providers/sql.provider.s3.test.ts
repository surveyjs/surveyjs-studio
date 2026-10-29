import { createS3ByteStore } from "../bytes/s3.js";
import { s3Settings, scratchBucket } from "../bytes/scratch-buckets.js";
import { createSeededSqlProviders } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("sqlite with files in S3 (legacy fixture seed)", () =>
  createSeededSqlProviders("sqlite", async () => {
    const bucket = await scratchBucket();
    return {
      store: createS3ByteStore({ ...s3Settings(), bucket: bucket.name }),
      remove: bucket.remove,
    };
  }),
);
