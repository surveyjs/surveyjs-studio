import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { describeByteStoreSuite, newKey } from "./byte-store-suite.js";
import { createLocalByteStore } from "./local.js";

describeByteStoreSuite("local disk", () => {
  const root = mkdtempSync(join(tmpdir(), "surveyjs-studio-files-"));
  return Promise.resolve({
    store: createLocalByteStore(join(root, "files")),
    remove: () => Promise.resolve(rmSync(root, { recursive: true, force: true })),
  });
});

describe("local byte store", () => {
  const root = mkdtempSync(join(tmpdir(), "surveyjs-studio-files-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("keeps a file at {root}/{survey id}/{file id}, with no temporary file left", async () => {
    const store = createLocalByteStore(root);
    const key = newKey();
    await store.put(key, Buffer.from("bytes"), "text/plain");
    const [survey, file] = key.split("/") as [string, string];
    expect(existsSync(join(root, survey, file))).toBe(true);
    expect(readdirSync(join(root, survey))).toEqual([file]);
  });

  it("creates its folder when it first writes", async () => {
    const store = createLocalByteStore(join(root, "made", "later"));
    expect(await store.probe()).toEqual({ ok: true });
    expect(existsSync(join(root, "made", "later"))).toBe(true);
  });
});
