/**
 * Replaces every occurrence of each old file id (a key of `ids`) with its new id. File ids are 64
 * hex digits, so a plain text replace hits nothing else and keeps whatever origin the URLs carry.
 */
export function rewriteFileIds(text: string, ids: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [oldId, newId] of ids) result = result.replaceAll(oldId, newId);
  return result;
}
