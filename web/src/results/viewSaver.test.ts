import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewSaver } from "./viewSaver";

interface Call {
  state: Record<string, unknown>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function setup() {
  const calls: Call[] = [];
  const errors: unknown[] = [];
  const onSaved = vi.fn();
  const saver = createViewSaver({
    save: (state) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ state, resolve, reject });
      }),
    onError: (error) => errors.push(error),
    onSaved,
  });
  return { saver, calls, errors, onSaved };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the view saver", () => {
  it("saves one change 500 ms after it", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }]);
  });

  it("restarts the timer on every change and saves the last one", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(400);
    saver.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(400);
    saver.change({ n: 3 });
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.state)).toEqual([{ n: 3 }]);
  });

  it("keeps one request in flight and sends only the latest waiting state", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(500);
    saver.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(500);
    saver.change({ n: 3 });
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }]);
    calls[0]!.resolve();
    await settle();
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }, { n: 3 }]);
  });

  it("flush sends a waiting state at once and resolves after it", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    let done = false;
    const flushed = saver.flush().then(() => (done = true));
    await settle();
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }]);
    expect(done).toBe(false);
    calls[0]!.resolve();
    await flushed;
    expect(done).toBe(true);
  });

  it("flush with nothing to send resolves", async () => {
    const { saver, calls } = setup();
    await saver.flush();
    expect(calls).toHaveLength(0);
  });

  it("reports a failed save and saves the next change", async () => {
    const { saver, calls, errors, onSaved } = setup();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(500);
    const failure = new Error("down");
    calls[0]!.reject(failure);
    await settle();
    expect(errors).toEqual([failure]);
    expect(onSaved).not.toHaveBeenCalled();
    saver.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("reports a success", async () => {
    const { saver, calls, onSaved } = setup();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(500);
    calls[0]!.resolve();
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a waiting state and waits for the save in flight", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    await saver.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(0);

    saver.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(500);
    let done = false;
    const cancelled = saver.cancel().then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    calls[0]!.resolve();
    await cancelled;
    expect(done).toBe(true);
  });

  it("ignores changes after close", async () => {
    const { saver, calls } = setup();
    await saver.close();
    saver.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
  });

  it("close sends a waiting state first", async () => {
    const { saver, calls } = setup();
    saver.change({ n: 1 });
    const closed = saver.close();
    await settle();
    expect(calls.map((c) => c.state)).toEqual([{ n: 1 }]);
    calls[0]!.resolve();
    await closed;
  });
});
