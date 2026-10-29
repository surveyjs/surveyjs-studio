import type { FilesConfig } from "../config.js";
import { createLocalByteStore } from "./local.js";
import type { ByteStore } from "./types.js";

export type { ByteStore } from "./types.js";

/** The byte store FILE_STORE names. */
export function openByteStore(files: FilesConfig): ByteStore {
  if (files.kind === "local") return createLocalByteStore(files.path);
  throw new Error("FILE_STORE=s3 is not available yet");
}
