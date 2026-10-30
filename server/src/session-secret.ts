import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ConfigError } from "./config.js";

const MIN_LENGTH = 32;
const DENIED = new Set(["EACCES", "EPERM", "EROFS"]);

function code(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "unknown";
}

function unusable(path: string, error: unknown): ConfigError {
  const c = code(error);
  const hint = DENIED.has(c)
    ? "; the folder must be writable by the container's user (uid 1000)"
    : "";
  return new ConfigError(`SESSION_SECRET_FILE: cannot read or create ${path} (${c})${hint}`);
}

async function readSecret(path: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (code(error) === "ENOENT") throw error;
    throw unusable(path, error);
  }
  const secret = text.trim();
  if (secret.length < MIN_LENGTH) {
    throw new ConfigError(`SESSION_SECRET_FILE: ${path} holds fewer than ${MIN_LENGTH} characters`);
  }
  return secret;
}

/**
 * Returns a copy of `env`. When `SESSION_SECRET` is blank or unset and `SESSION_SECRET_FILE` is
 * set, `SESSION_SECRET` comes from that file; a missing file is created once with a random
 * secret (mode 0600). Never puts the secret in an error message.
 */
export async function withSessionSecret(
  env: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, string | undefined>> {
  const copy = { ...env };
  const path = env.SESSION_SECRET_FILE?.trim();
  if (env.SESSION_SECRET?.trim() || !path) return copy;
  try {
    copy.SESSION_SECRET = await readSecret(path);
    return copy;
  } catch (error) {
    if (error instanceof ConfigError || code(error) !== "ENOENT") throw error;
  }
  // Write a complete file under a temporary name, then link it in: the target never shows partial content.
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      temporary,
      `${randomBytes(48).toString("base64url")}
`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await link(temporary, path);
  } catch (error) {
    if (code(error) !== "EEXIST") throw unusable(path, error);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  try {
    copy.SESSION_SECRET = await readSecret(path);
  } catch (error) {
    throw error instanceof ConfigError ? error : unusable(path, error);
  }
  return copy;
}
