// The image tags a `v*` git tag publishes, and the release the upgrade check starts from.

const VERSION = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

type Version = { major: number; minor: number; patch: number; preRelease: string | undefined };

function parse(tag: string): Version | null {
  const match = VERSION.exec(tag);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preRelease: match[4],
  };
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The image tags for a git ref: `refs/tags/v1.2.3` gives `v1.2.3`, `v1.2` and `latest`; a
 * pre-release (`v1.2.3-rc.1`) gives only itself. Any other ref gives null.
 */
export function releaseTags(ref: string): string[] | null {
  const prefix = "refs/tags/";
  if (!ref.startsWith(prefix)) return null;
  const tag = ref.slice(prefix.length);
  const version = parse(tag);
  if (!version) return null;
  if (version.preRelease !== undefined) return [tag];
  return [tag, `v${version.major}.${version.minor}`, "latest"];
}

/**
 * The highest release (`vX.Y.Z`, no pre-release) below `current`, or null when there is none.
 * A pre-release of a version counts as below that version.
 */
export function previousRelease(tags: string[], current: string): string | null {
  const now = parse(current);
  if (!now) return null;
  let best: { tag: string; version: Version } | null = null;
  for (const tag of tags) {
    const version = parse(tag);
    if (!version || version.preRelease !== undefined) continue;
    if (compare(version, now) >= 0) continue;
    if (best === null || compare(version, best.version) > 0) best = { tag, version };
  }
  return best?.tag ?? null;
}
