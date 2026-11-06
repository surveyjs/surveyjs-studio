// The arguments of `pnpm test:conformance` (cli.ts): `--base <url>` points the suite at a running
// server; everything else goes to Vitest.

export class UsageError extends Error {}

export interface ConformanceArgs {
  /** The server's origin without a trailing slash, or null to start the reference server. */
  baseUrl: string | null;
  /** The arguments for Vitest, in order. */
  rest: string[];
}

function normalizeBase(value: string | undefined): string {
  if (value === undefined || value === "" || value.startsWith("-")) {
    throw new UsageError("--base needs the server's origin, e.g. --base http://127.0.0.1:3000");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--base is not a URL: "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--base must be an http or https URL, got "${value}"`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "") {
    throw new UsageError(
      `--base is the server's origin without /api/v1 (the suite adds it), got "${value}"`,
    );
  }
  return url.origin;
}

/** Pnpm runs the root script as `cli.ts -- --base url`, so one leading `--` is dropped. */
export function parseConformanceArgs(argv: string[]): ConformanceArgs {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let baseUrl: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--base") {
      baseUrl = normalizeBase(args[++i]);
    } else if (arg.startsWith("--base=")) {
      baseUrl = normalizeBase(arg.slice("--base=".length));
    } else {
      rest.push(arg);
    }
  }
  return { baseUrl, rest };
}
