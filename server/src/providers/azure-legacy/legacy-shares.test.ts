import { describe, expect, it } from "vitest";
import { LegacyStoreError } from "./errors.js";
import { createStubShareReader, stubShareRoot } from "./legacy-shares-stub.js";
import { createLegacyShareReader, shareReaderOf, type ShareRoot } from "./legacy-shares.js";

const AZURITE =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;" +
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";
/** A synthetic cloud account: building the clients makes no request. */
const CLOUD =
  "DefaultEndpointsProtocol=https;AccountName=legacysurveys;AccountKey=a2V5;EndpointSuffix=core.windows.net";

const NAME = "0b5c7c6e-0000-4000-8000-a00000000001";
const BYTES = Buffer.from("legacy bytes");

function logger() {
  const lines: [Readonly<Record<string, string>>, string][] = [];
  return {
    lines,
    warn: (details: Readonly<Record<string, string>>, message: string) =>
      void lines.push([details, message]),
  };
}

describe("createLegacyShareReader", () => {
  it("has no reader for the local emulator, which has no file service", () => {
    const log = logger();
    for (const local of [AZURITE, "UseDevelopmentStorage=true"]) {
      expect(
        createLegacyShareReader(
          { surveysStorageConnectionString: local, resultsStorageConnectionString: local },
          log,
        ),
      ).toBeNull();
    }
    expect(log.lines).toEqual([]);
  });

  it("builds a reader for a cloud account without a request", () => {
    expect(
      createLegacyShareReader(
        { surveysStorageConnectionString: CLOUD, resultsStorageConnectionString: AZURITE },
        logger(),
      ),
    ).not.toBeNull();
  });

  it("warns without the connection string when the file SDK cannot use it", () => {
    const log = logger();
    const reader = createLegacyShareReader(
      {
        surveysStorageConnectionString: "Secret-Not-A-Connection-String",
        resultsStorageConnectionString: AZURITE,
      },
      log,
    );
    expect(reader).toBeNull();
    expect(log.lines).toHaveLength(1);
    expect(JSON.stringify(log.lines)).not.toContain("Secret");
    expect(log.lines[0]?.[0]).toEqual({
      setting: "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
      share: "surveyfiles",
    });
  });
});

describe("shareReaderOf", () => {
  const reader = createStubShareReader([
    { share: "surveyfiles", name: NAME, content: BYTES },
    { share: "files", name: `${NAME}.png`, content: BYTES },
    { share: "files", name: `${NAME}0.png`, content: Buffer.from("other") },
  ]);

  it("reads a file of each share by its exact name", async () => {
    expect(await reader.read("surveyfiles", NAME)).toStrictEqual(BYTES);
    expect(await reader.read("files", `${NAME}.png`)).toStrictEqual(BYTES);
  });

  it("answers null for another case, although Azure Files would find it", async () => {
    expect(await reader.read("surveyfiles", NAME.toUpperCase())).toBeNull();
    expect(await reader.read("files", `${NAME}.PNG`)).toBeNull();
  });

  it("answers null for an unknown name, a prefix of a name and a file of the other share", async () => {
    expect(await reader.read("surveyfiles", "0b5c7c6e-0000-4000-8000-a00000000099")).toBeNull();
    expect(await reader.read("files", NAME)).toBeNull();
    expect(await reader.read("surveyfiles", `${NAME}.png`)).toBeNull();
  });

  it("answers null for a share without a root", async () => {
    expect(await shareReaderOf({}).read("files", NAME)).toBeNull();
  });

  it("lists nothing for a name that is no legacy file name", async () => {
    const asked: string[] = [];
    const root = stubShareRoot([{ name: NAME, content: BYTES }]);
    const spied: ShareRoot = {
      listFilesAndDirectories: (options) => {
        asked.push(options.prefix);
        return root.listFilesAndDirectories(options);
      },
      getFileClient: (name) => {
        asked.push(name);
        return root.getFileClient(name);
      },
    };
    const spiedReader = shareReaderOf({ surveyfiles: spied });
    for (const name of ["../x", "a/b", "..", "", "a b"]) {
      expect(await spiedReader.read("surveyfiles", name)).toBeNull();
    }
    expect(asked).toEqual([]);
    expect(await spiedReader.read("surveyfiles", NAME)).toStrictEqual(BYTES);
    expect(asked).toEqual([NAME, NAME]);
  });

  it("follows the listing for up to 10 pages of 100 names", async () => {
    // Names that start with the wanted one, listed before it (the stub keeps the given order).
    const longer = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ name: `${NAME}.${String(i)}`, content: BYTES }));
    const onPageTen = shareReaderOf({
      surveyfiles: stubShareRoot([...longer(900), { name: NAME, content: BYTES }]),
    });
    expect(await onPageTen.read("surveyfiles", NAME)).toStrictEqual(BYTES);
    const onPageEleven = shareReaderOf({
      surveyfiles: stubShareRoot([...longer(1000), { name: NAME, content: BYTES }]),
    });
    expect(await onPageEleven.read("surveyfiles", NAME)).toBeNull();
  });

  it("answers null when the file goes between the listing and the read", async () => {
    const root = stubShareRoot([{ name: NAME, content: BYTES }]);
    const gone: ShareRoot = {
      listFilesAndDirectories: (options) => root.listFilesAndDirectories(options),
      getFileClient: () => stubShareRoot([]).getFileClient(NAME),
    };
    expect(await shareReaderOf({ surveyfiles: gone }).read("surveyfiles", NAME)).toBeNull();
  });

  it("rejects with a LegacyStoreError that names no host on any other failure", async () => {
    const failing: ShareRoot = {
      listFilesAndDirectories: () => ({
        byPage: () => ({
          next: () =>
            Promise.reject(
              Object.assign(new Error("connect to legacysurveys.file.core.windows.net failed"), {
                statusCode: 503,
              }),
            ),
        }),
      }),
      getFileClient: () => ({ downloadToBuffer: () => Promise.resolve(BYTES) }),
    };
    const read = shareReaderOf({ files: failing }).read("files", NAME);
    await expect(read).rejects.toBeInstanceOf(LegacyStoreError);
    await expect(read).rejects.not.toThrow(/legacysurveys/);
  });
});
