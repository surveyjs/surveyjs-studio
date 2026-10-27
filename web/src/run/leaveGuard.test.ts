import { afterEach, describe, expect, it } from "vitest";
import { guardLeaving } from "./leaveGuard";

/** Dispatches `beforeunload` as the browser does; true when the page would ask. */
function leaving(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

let release: (() => void) | undefined;

afterEach(() => {
  release?.();
  release = undefined;
});

describe("guardLeaving", () => {
  it("makes the page ask before it is left", () => {
    release = guardLeaving();

    expect(leaving()).toBe(true);
  });

  it("stops asking once released", () => {
    guardLeaving()();

    expect(leaving()).toBe(false);
  });

  it("keeps asking while another guard holds", () => {
    release = guardLeaving();
    guardLeaving()();

    expect(leaving()).toBe(true);
  });

  it("does not ask without a guard", () => {
    expect(leaving()).toBe(false);
  });
});
