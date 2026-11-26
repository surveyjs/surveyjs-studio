import { isLegacyFileName } from "../../domain/legacy-file.js";
import type { FileKind } from "../../domain/types.js";

/**
 * An editor asset link: `{scheme}://{host}/private/Surveys/files?name={name}` or the same action
 * under `/private/v1/`, in a definition or theme, alone or inside HTML. As the old API routed it,
 * the path and the parameter's name are in any letter case, and `name` may come anywhere in the
 * query (after `&`, or `&amp;` inside HTML). The name ends at a character that cannot be part of it.
 */
const ASSET_LINK =
  /https?:\/\/[^/\s"'<>]+\/private\/(?:v1\/)?Surveys\/files\?(?:[^#\s"'<>)\\]*?&(?:amp;)?)?name=([^&#\s"'<>)\\]+)/gi;
/** A respondent file value: `dxsimage:{name}` or `dxsfile:{name}`, the whole string. */
const RESPONSE_LINK = /^dxs(?:image|file):([^\s]+)$/;

function decoded(name: string): string | null {
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
}

/**
 * The legacy files a parsed JSON value links (a definition, theme, history snapshot or response
 * answers, at any depth, also inside arrays of files), each once, in document order. Names the
 * legacy file-name rule refuses are not links.
 */
export function fileLinks(json: unknown): { kind: FileKind; name: string }[] {
  const found = new Map<string, { kind: FileKind; name: string }>();
  const add = (kind: FileKind, raw: string): void => {
    const name = decoded(raw);
    if (name !== null && isLegacyFileName(name)) found.set(`${kind}/${name}`, { kind, name });
  };
  const pending: unknown[] = [json];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node === "string") {
      for (const match of node.matchAll(ASSET_LINK)) add("asset", match[1]!);
      const response = RESPONSE_LINK.exec(node);
      if (response) add("response", response[1]!);
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) pending.push(node[i]);
    } else if (typeof node === "object" && node !== null) {
      const values = Object.values(node);
      for (let i = values.length - 1; i >= 0; i -= 1) pending.push(values[i]);
    }
  }
  return [...found.values()];
}
