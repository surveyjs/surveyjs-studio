import { chmod, mkdir, readdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "./config.js";
import { withSessionSecret } from "./session-secret.js";

const posix = process.platform !== "win32";
const isRoot = posix && process.getuid?.() === 0;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-secret-"));
});
afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe("withSessionSecret", () => {
  it("creates the file when missing and keeps the same secret", async () => {
    const file = join(dir, "session-secret");
    const first = await withSessionSecret({ SESSION_SECRET_FILE: file });
    expect(first.SESSION_SECRET).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(await readFile(file, "utf8")).toBe(`${first.SESSION_SECRET}\n`);
    const second = await withSessionSecret({ SESSION_SECRET_FILE: file });
    expect(second.SESSION_SECRET).toBe(first.SESSION_SECRET);
    if (posix) expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("creates a missing parent folder", async () => {
    const file = join(dir, "a", "b", "session-secret");
    const result = await withSessionSecret({ SESSION_SECRET_FILE: file });
    expect(await readFile(file, "utf8")).toBe(`${result.SESSION_SECRET}\n`);
  });

  it("treats a blank SESSION_SECRET as unset", async () => {
    const result = await withSessionSecret({
      SESSION_SECRET: "  ",
      SESSION_SECRET_FILE: join(dir, "s"),
    });
    expect(result.SESSION_SECRET).toHaveLength(64);
  });

  it("returns SESSION_SECRET unchanged and creates no file", async () => {
    const file = join(dir, "session-secret");
    const env = { SESSION_SECRET: "x".repeat(40), SESSION_SECRET_FILE: file };
    const result = await withSessionSecret(env);
    expect(result).toEqual(env);
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns env unchanged when neither variable is set", async () => {
    const env = { NODE_ENV: "test" };
    const result = await withSessionSecret(env);
    expect(result).toEqual(env);
    expect(result).not.toBe(env);
  });

  it("rejects a short file without quoting it", async () => {
    const file = join(dir, "session-secret");
    await writeFile(file, "short\n");
    const error = await withSessionSecret({ SESSION_SECRET_FILE: file }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toBe(`SESSION_SECRET_FILE: ${file} holds fewer than 32 characters`);
    expect(message).not.toContain("short\n");
  });

  it.skipIf(!posix || isRoot)("names the container user when the folder is read-only", async () => {
    const folder = join(dir, "ro");
    await mkdir(folder);
    await chmod(folder, 0o500);
    const error = await withSessionSecret({
      SESSION_SECRET_FILE: join(folder, "session-secret"),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain("(EACCES)");
    expect((error as Error).message).toContain("uid 1000");
  });

  it("returns the same secret for many concurrent calls and leaves no temporary file", async () => {
    const env = { SESSION_SECRET_FILE: join(dir, "session-secret") };
    const results = await Promise.all(Array.from({ length: 20 }, () => withSessionSecret(env)));
    expect(new Set(results.map((r) => r.SESSION_SECRET)).size).toBe(1);
    expect(await readdir(dir)).toEqual(["session-secret"]);
  });
});
