import type { FilesConfig } from "../config.js";
import { createLocalByteStore } from "./local.js";
import { createS3ByteStore } from "./s3.js";
import type { ByteStore } from "./types.js";

export type { ByteStore } from "./types.js";

/** The byte store FILE_STORE names. */
export function openByteStore(files: FilesConfig): ByteStore {
  return files.kind === "local" ? createLocalByteStore(files.path) : createS3ByteStore(files);
}
