import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, constants, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { checkKey, type ByteStore } from "./types.js";

/**
 * File bytes in a folder (FILE_STORE=local, FILES_PATH; /data/files in the image), at
 * `{root}/{survey id}/{file id}`. A write goes to a temporary file in the same folder and is then
 * renamed into place, so a reader sees the old bytes or the new ones, never a part.
 */
export function createLocalByteStore(root: string): ByteStore {
  const pathOf = (key: string): string => {
    const [survey, file] = checkKey(key).split("/") as [string, string];
    return join(root, survey, file);
  };

  /** Writes through a temporary file next to `path`, then renames it into place. */
  const writeAtomically = async (
    path: string,
    write: (temporary: string) => Promise<void>,
  ): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await write(temporary);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  };

  return {
    put: async (key, content) => {
      const path = pathOf(key);
      await writeAtomically(path, (temporary) => writeFile(temporary, content));
    },
    get: async (key) => {
      const path = pathOf(key);
      try {
        await access(path, constants.R_OK);
      } catch {
        return null;
      }
      return createReadStream(path) as Readable;
    },
    delete: async (keys) => {
      const paths = keys.map(pathOf);
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    },
    copy: async (fromKey, toKey) => {
      const from = pathOf(fromKey);
      const to = pathOf(toKey);
      await writeAtomically(to, (temporary) => copyFile(from, temporary));
    },
    probe: async () => {
      try {
        await mkdir(root, { recursive: true });
        await access(root, constants.W_OK);
        return { ok: true };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return { ok: false, ...(typeof code === "string" && { reason: code }) };
      }
    },
  };
}
