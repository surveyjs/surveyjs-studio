import { describe, expect, it } from "vitest";
import {
  createDocumentSaver,
  editorStatus,
  isSafeToLeave,
  statusText,
  type SaverState,
} from "./autosave";

interface Call {
  content: string;
  etag: string;
  resolve: (etag: string) => void;
  reject: (error: unknown) => void;
}

function setup() {
  const calls: Call[] = [];
  const states: SaverState[] = [];
  const saver = createDocumentSaver<string>({
    etag: "e0",
    save: (content, etag) =>
      new Promise<string>((resolve, reject) => calls.push({ content, etag, resolve, reject })),
    isConflict: (error) => error === "conflict",
    onChange: (state) => states.push(state),
  });
  return { saver, calls, states };
}

/** Lets the saver's promise continuations run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createDocumentSaver", () => {
  it("saves one request with the initial ETag", async () => {
    const { saver, calls, states } = setup();
    const done: boolean[] = [];
    saver.request("a", (ok) => done.push(ok));
    expect(calls.map((c) => [c.content, c.etag])).toEqual([["a", "e0"]]);
    expect(saver.state).toBe("saving");
    calls[0]!.resolve("e1");
    await flush();
    expect(done).toEqual([true]);
    expect(saver.state).toBe("saved");
    expect(states).toEqual(["saving", "saved"]);
  });

  it("chains two requests with the new ETag", async () => {
    const { saver, calls } = setup();
    const done: boolean[] = [];
    saver.request("a", (ok) => done.push(ok));
    saver.request("b", (ok) => done.push(ok));
    expect(calls).toHaveLength(1);
    calls[0]!.resolve("e1");
    await flush();
    expect(calls.map((c) => [c.content, c.etag])).toEqual([
      ["a", "e0"],
      ["b", "e1"],
    ]);
    expect(done).toEqual([true]);
    calls[1]!.resolve("e2");
    await flush();
    expect(done).toEqual([true, true]);
    expect(saver.state).toBe("saved");
  });

  it("never sends the middle of three requests", async () => {
    const { saver, calls } = setup();
    const done: boolean[] = [];
    for (const content of ["a", "b", "c"]) saver.request(content, (ok) => done.push(ok));
    calls[0]!.resolve("e1");
    await flush();
    calls[1]!.resolve("e2");
    await flush();
    expect(calls.map((c) => c.content)).toEqual(["a", "c"]);
    expect(done).toEqual([true, true, true]);
  });

  it("reports an error and retries with the same ETag", async () => {
    const { saver, calls } = setup();
    const done: boolean[] = [];
    saver.request("a", (ok) => done.push(ok));
    calls[0]!.reject(new Error("offline"));
    await flush();
    expect(saver.state).toBe("error");
    expect(done).toEqual([false]);
    saver.request("b", (ok) => done.push(ok));
    expect(calls[1]).toMatchObject({ content: "b", etag: "e0" });
    calls[1]!.resolve("e1");
    await flush();
    expect(saver.state).toBe("saved");
    expect(done).toEqual([false, true]);
  });

  it("stops on a conflict until reset", async () => {
    const { saver, calls } = setup();
    const done: boolean[] = [];
    saver.request("a", (ok) => done.push(ok));
    saver.request("b", (ok) => done.push(ok));
    calls[0]!.reject("conflict");
    await flush();
    expect(saver.state).toBe("conflict");
    expect(done).toEqual([false, false]);
    saver.request("c", (ok) => done.push(ok));
    expect(done).toEqual([false, false, false]);
    expect(calls).toHaveLength(1);
    saver.reset("e9");
    expect(saver.state).toBe("saved");
    saver.request("d", (ok) => done.push(ok));
    expect(calls[1]).toMatchObject({ content: "d", etag: "e9" });
  });
});

describe("editorStatus", () => {
  it("applies the precedence", () => {
    expect(editorStatus(["conflict", "saving"], true)).toEqual({ kind: "read-only" });
    expect(editorStatus(["error", "saving", "conflict"], false)).toEqual({ kind: "conflict" });
    expect(editorStatus(["error", "saving"], false)).toEqual({ kind: "saving" });
    expect(editorStatus(["saved", "error"], false)).toEqual({ kind: "error" });
    expect(editorStatus(["saved", "saved"], false)).toEqual({ kind: "saved" });
  });

  it("counts a change not yet handed to a saver as saving", () => {
    expect(editorStatus(["saved", "saved"], false, true)).toEqual({ kind: "saving" });
    expect(editorStatus(["saved", "error"], false, true)).toEqual({ kind: "saving" });
    expect(editorStatus(["conflict", "saved"], false, true)).toEqual({ kind: "conflict" });
    expect(editorStatus(["saved", "saved"], true, true)).toEqual({ kind: "read-only" });
  });

  it("tells when leaving the page is safe", () => {
    expect(isSafeToLeave({ kind: "saved" })).toBe(true);
    expect(isSafeToLeave({ kind: "read-only" })).toBe(true);
    for (const kind of ["saving", "error", "conflict"] as const) {
      expect(isSafeToLeave({ kind })).toBe(false);
    }
  });

  it("has the footer texts", () => {
    expect(statusText).toEqual({
      "read-only": "Read-only",
      saving: "Saving…",
      error: "Changes are not saved",
      saved: "All changes saved",
    });
  });
});
