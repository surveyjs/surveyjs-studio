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
