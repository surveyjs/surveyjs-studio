import { describe, expect, it } from "vitest";
import { isDeadlockVictim, withDeadlockRetry } from "./writes.js";

/** A run that throws `errors` one by one, then answers "done"; it records each attempt. */
function scripted(errors: unknown[]) {
  const attempts: number[] = [];
  const run = (attempt: number) => {
    attempts.push(attempt);
    const error = errors.shift();
    return error === undefined ? Promise.resolve("done") : Promise.reject(error);
  };
  return { run, attempts };
}

const deadlock = () => Object.assign(new Error("deadlock"), { number: 1205 });

describe("isDeadlockVictim", () => {
  it("recognises SQL error 1205 on the error or on its original error", () => {
    expect(isDeadlockVictim({ number: 1205 })).toBe(true);
    expect(isDeadlockVictim({ originalError: { number: 1205 } })).toBe(true);
  });

  it("rejects other errors and non-objects", () => {
    expect(isDeadlockVictim({ number: 2627 })).toBe(false);
    expect(isDeadlockVictim({ number: "1205" })).toBe(false);
    expect(isDeadlockVictim({ originalError: { number: 547 } })).toBe(false);
    expect(isDeadlockVictim(new Error("1205"))).toBe(false);
    expect(isDeadlockVictim(null)).toBe(false);
    expect(isDeadlockVictim(1205)).toBe(false);
  });
});

describe("withDeadlockRetry", () => {
  it("runs a deadlock victim again, waiting before each new attempt", async () => {
    const { run, attempts } = scripted([deadlock(), deadlock()]);
    const waits: number[] = [];
    const wait = (attempt: number) => {
      waits.push(attempt);
      return Promise.resolve();
    };
    await expect(withDeadlockRetry(run, 3, wait)).resolves.toBe("done");
    expect(attempts).toEqual([1, 2, 3]);
    expect(waits).toEqual([1, 2]);
  });

  it("gives up after the last attempt with the last error", async () => {
    const last = deadlock();
    const { run, attempts } = scripted([deadlock(), deadlock(), last, deadlock()]);
    await expect(withDeadlockRetry(run, 3, () => Promise.resolve())).rejects.toBe(last);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("never runs again after any other error", async () => {
    const duplicate = Object.assign(new Error("duplicate key"), { number: 2627 });
    const { run, attempts } = scripted([duplicate]);
    await expect(withDeadlockRetry(run, 3, () => Promise.resolve())).rejects.toBe(duplicate);
    expect(attempts).toEqual([1]);
  });

  it("waits a short, growing time by default", async () => {
    const { run, attempts } = scripted([deadlock()]);
    const started = Date.now();
    await expect(withDeadlockRetry(run)).resolves.toBe("done");
    expect(attempts).toEqual([1, 2]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
