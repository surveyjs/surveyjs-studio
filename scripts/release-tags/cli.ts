// The release workflow's tags.
//   tsx scripts/release-tags/cli.ts <git ref> [--master <ref>]
//                                     the image tags, one per line; exit 1 for a ref that is not a
//                                     release tag (vX.Y.Z or vX.Y.Z-pre), or when git cannot tell
//                                     whether the tagged commit is on master. `latest` is listed
//                                     only when it is (--master: default origin/master)
//   tsx scripts/release-tags/cli.ts --previous <tag>
//                                     the releases below <tag> among the repository's git tags,
//                                     highest first, one per line; prints nothing for none
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { previousReleases, releaseTags } from "./release-tags.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { previous: { type: "string" }, master: { type: "string", default: "origin/master" } },
  allowPositionals: true,
});

if (values.previous !== undefined) {
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const tag of previousReleases(tags, values.previous)) console.log(tag);
  process.exit(0);
}

/** Whether the commit `ref` names is `master` or one of its ancestors. Exits on a git error. */
function isOnMaster(ref: string, master: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", `${ref}^{commit}`, master], {
    encoding: "utf8",
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  console.error(
    `git merge-base --is-ancestor ${ref} ${master} failed: ${(result.stderr || String(result.error)).trim()}`,
  );
  process.exit(1);
}

const [ref] = positionals;
// Git is asked about master only for a valid release tag.
if (ref === undefined || releaseTags(ref, { onMaster: false }) === null) {
  console.error(
    `not a release tag: ${ref ?? "(none)"} (expected refs/tags/vX.Y.Z or refs/tags/vX.Y.Z-pre)`,
  );
  process.exit(1);
}
for (const tag of releaseTags(ref, { onMaster: isOnMaster(ref, values.master) }) ?? []) {
  console.log(tag);
}
