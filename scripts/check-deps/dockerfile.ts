/** Problems with the `FROM node:<version>` tags of a Dockerfile compared with `.nvmrc`. */
export function dockerfileNodeProblems(dockerfile: string, nvmrc: string): string[] {
  const wanted = nvmrc.trim().replace(/^v/, "");
  const problems: string[] = [];
  let found = 0;
  dockerfile.split(/\r?\n/).forEach((line, index) => {
    const from = /^\s*FROM\s+(?:--\S+\s+)*node:(\S+)/i.exec(line);
    if (!from?.[1]) return;
    found += 1;
    const version = /^(\d+\.\d+\.\d+)(?:-\S+)?$/.exec(from[1])?.[1];
    if (version === undefined) {
      problems.push(
        `Dockerfile:${index + 1}: node tag "${from[1]}" is not an exact version (want ${wanted})`,
      );
    } else if (version !== wanted) {
      problems.push(`Dockerfile:${index + 1}: node ${version} differs from .nvmrc ${wanted}`);
    }
  });
  if (found === 0) problems.push("Dockerfile: no `FROM node:<version>` line found");
  return problems;
}

/**
 * Patterns `.dockerignore` must hold so no settings or key file reaches the build context, and so
 * none can reach the image (`COPY . .`, then `pnpm deploy` of the server package).
 */
export const REQUIRED_DOCKERIGNORE: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/*.env",
  "**/*.pfx",
  "**/*.pem",
  "**/*.key",
  "**/secrets.*",
  "**/appsettings*.json",
  "**/SSL",
];

/** The only settings file a `!pattern` may re-include: a template without values. */
const ALLOWED_NEGATIONS: readonly string[] = ["!**/.env.example"];
const SECRET_LIKE = /\.env|\.pfx|\.pem|\.key|secrets|appsettings|ssl/i;

/** Problems with `.dockerignore`: a missing secret pattern, or a negation that lets one back in. */
export function dockerignoreProblems(dockerignore: string): string[] {
  const lines = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const problems = REQUIRED_DOCKERIGNORE.filter((pattern) => !lines.includes(pattern)).map(
    (pattern) =>
      `.dockerignore: missing "${pattern}" (a settings or key file would reach the image)`,
  );
  for (const line of lines) {
    if (line.startsWith("!") && SECRET_LIKE.test(line) && !ALLOWED_NEGATIONS.includes(line)) {
      problems.push(
        `.dockerignore: "${line}" re-includes files; only ${ALLOWED_NEGATIONS.join(", ")} may`,
      );
    }
  }
  return problems;
}
