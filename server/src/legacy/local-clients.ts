import { TableClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { assertLocalClientUrl } from "./endpoint-guard.js";

/**
 * The only way the fixture loader obtains storage clients. Each one is built first and then checked
 * by the URL the SDK itself resolved, so a connection string that the guard reads differently from
 * the SDK still cannot reach a real Azure account. Building a client makes no network call.
 */

function build<T extends { url: string }>(variableName: string, create: () => T): T {
  let client: T;
  try {
    client = create();
  } catch {
    // The SDK's own message may quote the connection string.
    throw new Error(`${variableName} is not a valid Azure Storage connection string`);
  }
  assertLocalClientUrl(client.url, variableName);
  return client;
}

export function localBlobServiceClient(
  connectionString: string,
  variableName: string,
): BlobServiceClient {
  return build(variableName, () => BlobServiceClient.fromConnectionString(connectionString));
}

export function localTableClient(
  connectionString: string,
  tableName: string,
  variableName: string,
): TableClient {
  return build(variableName, () =>
    TableClient.fromConnectionString(connectionString, tableName, {
      allowInsecureConnection: true,
    }),
  );
}
