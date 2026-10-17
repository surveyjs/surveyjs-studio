import { randomBytes } from "node:crypto";

/** 64 lower-case hex digits. */
export const FILE_ID_PATTERN = /^[0-9a-f]{64}$/;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A new id for a file of `surveyId` (a GUID, any case; throws otherwise): its 32 hex digits, then 32 random. */
export function newFileId(
  surveyId: string,
  random: (size: number) => Uint8Array = randomBytes,
): string {
  if (!GUID.test(surveyId)) throw new Error("A file id needs the survey's GUID");
  return surveyId.replaceAll("-", "").toLowerCase() + Buffer.from(random(16)).toString("hex");
}

/** The lower-case GUID (with dashes) of the survey a file id names; null unless the id is 64 hex digits (any case). */
export function surveyIdOfFile(fileId: string): string | null {
  const id = fileId.toLowerCase();
  if (!FILE_ID_PATTERN.test(id)) return null;
  const h = id.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
