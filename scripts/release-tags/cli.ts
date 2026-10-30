// The release workflow's tags.
//   tsx scripts/release-tags/cli.ts <git ref>        the image tags, one per line; exit 1 for a ref
//                                                     that is not a release tag (vX.Y.Z or vX.Y.Z-pre)
//   tsx scripts/release-tags/cli.ts --previous <tag> the highest release below <tag> among the
//                                                     repository's git tags; prints nothing for none
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { previousRelease, releaseTags } from "./release-tags.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { previous: { type: "string" } },
  allowPositionals: true,
});

if (values.previous !== undefined) {
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const previous = previousRelease(tags, values.previous);
  if (previous !== null) console.log(previous);
  process.exit(0);
}

const [ref] = positionals;
const tags = ref === undefined ? null : releaseTags(ref);
if (tags === null) {
  console.error(
    `not a release tag: ${ref ?? "(none)"} (expected refs/tags/vX.Y.Z or refs/tags/vX.Y.Z-pre)`,
  );
  process.exit(1);
}
for (const tag of tags) console.log(tag);
