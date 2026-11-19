import {
  shareReaderOf,
  type LegacyShare,
  type LegacyShareReader,
  type ShareRoot,
} from "./legacy-shares.js";

/** A file of a stubbed share: as the fixtures hold them (`files/<account>/<share>/<name>`). */
export interface StubShareFile {
  readonly share: string;
  readonly name: string;
  readonly content: Buffer;
}

/**
 * Tests only: a share root over files in memory that answers as Azure Files does, matching names
 * without regard to case in listings and reads, and failing with a 404 for a missing file.
 */
export function stubShareRoot(files: readonly { name: string; content: Buffer }[]): ShareRoot {
  const fold = (name: string) => name.toLowerCase();
  return {
    listFilesAndDirectories: ({ prefix }) => ({
      byPage: ({ maxPageSize }) => {
        const fileItems = files
          .filter((file) => fold(file.name).slice(0, prefix.length) === fold(prefix))
          .slice(0, maxPageSize)
          .map((file) => ({ name: file.name }));
        let done = false;
        return {
          next: () => {
            const result = done
              ? { done: true as const, value: undefined }
              : { done: false as const, value: { segment: { fileItems } } };
            done = true;
            return Promise.resolve(result);
          },
        };
      },
    }),
    getFileClient: (name) => ({
      downloadToBuffer: () => {
        const found = files.find((file) => fold(file.name) === fold(name));
        return found
          ? Promise.resolve(Buffer.from(found.content))
          : Promise.reject(
              Object.assign(new Error("The file does not exist"), { statusCode: 404 }),
            );
      },
    }),
  };
}

/**
 * Tests only: the legacy share reader over the given files (Azurite has no file service), each
 * share holding the files listed for it.
 */
export function createStubShareReader(files: readonly StubShareFile[]): LegacyShareReader {
  const of = (share: LegacyShare) => stubShareRoot(files.filter((file) => file.share === share));
  return shareReaderOf({ surveyfiles: of("surveyfiles"), files: of("files") });
}
