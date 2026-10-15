import { describe, expect, it } from "vitest";
import { localBlobServiceClient, localTableClient } from "./local-clients.js";

// Building a client makes no network call, so these tests only see the URL the SDK resolved.
const VARIABLE = "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING";
const PROD = "DefaultEndpointsProtocol=https;AccountName=prodacct;AccountKey=a2V5";
const LOCAL_BLOB = "http://127.0.0.1:10000/devstoreaccount1";
const LOCAL_TABLE = "http://127.0.0.1:10002/devstoreaccount1";
const AZURITE = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE};`;

/** Strings an earlier guard accepted; each one sends the blob SDK, the table SDK or both to Azure. */
const REMOTE_FOR_BLOBS: [name: string, value: string][] = [
  [
    "remote endpoints first, local duplicates after",
    `${PROD};BlobEndpoint=https://prodacct.blob.core.windows.net/;` +
      `TableEndpoint=https://prodacct.table.core.windows.net;` +
      `BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`,
  ],
  [
    "lower-case endpoint keys next to a real account",
    `${PROD};EndpointSuffix=core.windows.net;blobendpoint=${LOCAL_BLOB};tableendpoint=${LOCAL_TABLE}`,
  ],
  [
    "a real account string with UseDevelopmentStorage=true appended",
    `${PROD};EndpointSuffix=core.windows.net;UseDevelopmentStorage=true`,
  ],
];

describe("local storage clients", () => {
  it("builds clients for the local replica", () => {
    expect(localBlobServiceClient(AZURITE, VARIABLE).url).toBe(LOCAL_BLOB);
    expect(localTableClient(AZURITE, "surveys", VARIABLE).url).toBe(LOCAL_TABLE);
    expect(localBlobServiceClient("UseDevelopmentStorage=true", VARIABLE).url).toContain(
      "127.0.0.1",
    );
  });

  it.each(REMOTE_FOR_BLOBS)("refuses a blob client the SDK points at Azure: %s", (_name, value) => {
    const build = () => localBlobServiceClient(value, VARIABLE);
    expect(build).toThrow(/LEGACY_SURVEYS_STORAGE_CONNECTION_STRING/);
    expect(build).not.toThrow(/prodacct/);
  });

  it("refuses a table client the SDK points at Azure", () => {
    const [, value] = REMOTE_FOR_BLOBS[0] ?? ["", ""];
    const build = () => localTableClient(value, "surveys", VARIABLE);
    expect(build).toThrow(/LEGACY_SURVEYS_STORAGE_CONNECTION_STRING/);
    expect(build).not.toThrow(/prodacct/);
  });

  it("refuses a string the SDK cannot read, without echoing it", () => {
    const build = () => localTableClient("AccountKey=c2VjcmV0", "surveys", VARIABLE);
    expect(build).toThrow(/LEGACY_SURVEYS_STORAGE_CONNECTION_STRING/);
    expect(build).not.toThrow(/c2VjcmV0/);
  });
});
