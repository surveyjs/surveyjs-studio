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
        const names = files
          .filter((file) => fold(file.name).slice(0, prefix.length) === fold(prefix))
          .map((file) => ({ name: file.name }));
        let offset = 0;
        return {
          next: () => {
            if (offset >= names.length) {
              return Promise.resolve({ done: true as const, value: undefined });
            }
            const fileItems = names.slice(offset, offset + maxPageSize);
            offset += maxPageSize;
            return Promise.resolve({ done: false as const, value: { segment: { fileItems } } });
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
 * share holding the files listed for it; `list` names a share's files.
 */
export function createStubShareReader(
  files: readonly StubShareFile[],
): LegacyShareReader & { list(share: LegacyShare): AsyncIterable<string> } {
  const of = (share: LegacyShare) => stubShareRoot(files.filter((file) => file.share === share));
  const reader = shareReaderOf({ surveyfiles: of("surveyfiles"), files: of("files") });
  return {
    read: (share, name) => reader.read(share, name),
    async *list(share) {
      for (const file of files) if (file.share === share) yield file.name;
    },
  };
}
