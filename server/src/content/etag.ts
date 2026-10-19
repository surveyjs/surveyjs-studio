/** The HTTP ETag for a document version: the strong tag `"<version>"`. */
export function formatEtag(version: string): string {
  return `"${version}"`;
}

/** One entity tag at the start of `text`: its weakness, its value and the text after it. */
function readTag(text: string): { weak: boolean; value: string; rest: string } | null {
  const weak = text.startsWith("W/");
  const body = weak ? text.slice(2) : text;
  if (!body.startsWith('"')) return null;
  const end = body.indexOf('"', 1);
  if (end < 0) return null;
  return { weak, value: body.slice(1, end), rest: body.slice(end + 1) };
}

/**
 * Whether an `If-Match` header allows a write to a document at `version` (RFC 9110 section 13.1.1):
 * `*` matches any version, otherwise one entity tag of the comma-separated list must be the strong
 * tag of the version. Weak tags never match. A header that is not a valid list matches nothing.
 */
export function ifMatchAllows(header: string, version: string): boolean {
  let rest = header.trim();
  if (rest === "*") return true;
  let allowed = false;
  for (;;) {
    const tag = readTag(rest);
    if (!tag) return false;
    if (!tag.weak && tag.value === version) allowed = true;
    rest = tag.rest.trimStart();
    if (rest === "") return allowed;
    if (!rest.startsWith(",")) return false;
    rest = rest.slice(1).trimStart();
  }
}
