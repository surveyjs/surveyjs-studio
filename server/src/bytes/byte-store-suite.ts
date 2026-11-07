import { randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ByteStore } from "./types.js";

/** A new well-formed key in a survey of its own. */
export const newKey = (survey: string = randomUUID()): string =>
  `${survey}/${randomBytes(32).toString("hex")}`;

export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** What every byte store does. `create` returns a store on an empty place, and how to remove it. */
export function describeByteStoreSuite(
  name: string,
  create: () => Promise<{ store: ByteStore; remove: () => Promise<void> }>,
): void {
  describe(`byte store: ${name}`, () => {
    let store: ByteStore;
    let remove: () => Promise<void>;
    beforeAll(async () => {
      ({ store, remove } = await create());
    });
    afterAll(async () => {
      await remove();
    });

    const read = async (key: string): Promise<Buffer | null> => {
      const stream = await store.get(key);
      return stream === null ? null : readAll(stream);
    };

    it("gives back the bytes it stored, and the latest when a key is written again", async () => {
      const key = newKey();
      await store.put(key, Buffer.from("first"), "text/plain");
      expect((await read(key))?.toString()).toBe("first");
      await store.put(key, Buffer.from("second"), "text/plain");
      expect((await read(key))?.toString()).toBe("second");
    });

    it("keeps binary content and an empty file exactly", async () => {
      const binary = randomBytes(70_000);
      const key = newKey();
      await store.put(key, binary, "application/octet-stream");
      expect((await read(key))?.equals(binary)).toBe(true);
      const empty = newKey();
      await store.put(empty, Buffer.alloc(0), "text/plain");
      expect((await read(empty))?.length).toBe(0);
    });

    it("answers null for a key with nothing stored", async () => {
      expect(await store.get(newKey())).toBeNull();
    });

    it("deletes the keys it is given, and is fine with keys that hold nothing", async () => {
      const survey = randomUUID();
      const [a, b, kept] = [newKey(survey), newKey(survey), newKey(survey)];
      for (const key of [a, b, kept]) await store.put(key, Buffer.from(key), "text/plain");
      await store.delete([a, b, newKey()]);
      expect(await store.get(a)).toBeNull();
      expect(await store.get(b)).toBeNull();
      expect((await read(kept))?.toString()).toBe(kept);
      await store.delete([]);
    });

    it("copies bytes to another key, and the copy outlives its source", async () => {
      const from = newKey();
      const to = newKey();
      await store.put(from, Buffer.from("copied"), "image/png");
      await store.copy(from, to);
      await store.delete([from]);
      expect((await read(to))?.toString()).toBe("copied");
    });

    it("refuses a key that is not {survey id}/{file id}", async () => {
      for (const key of ["../outside", `${randomUUID()}/../x`, newKey().toUpperCase(), ""]) {
        await expect(store.put(key, Buffer.from("x"), "text/plain")).rejects.toThrow(
          "Not a file key",
        );
        await expect(store.get(key)).rejects.toThrow("Not a file key");
        await expect(store.delete([key])).rejects.toThrow("Not a file key");
        await expect(store.copy(newKey(), key)).rejects.toThrow("Not a file key");
      }
    });

    it("reports that it can be written", async () => {
      expect(await store.probe()).toEqual({ ok: true });
    });
  });
}
