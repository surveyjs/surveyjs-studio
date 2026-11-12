import { describe, expect, it, vi } from "vitest";
import { guardRedrawUntilBuilt } from "./tabulatorRedrawGuard";

/** The parts of survey-analytics' Tabulator view and of the Tabulator table that the guard uses. */
function fakeView() {
  const inner = { initialized: false, redraw: vi.fn() };
  class View {
    tabulatorTables: typeof inner | null = null;
    observeContainerResize() {
      this.tabulatorTables = inner;
    }
  }
  return { View, inner };
}

describe("guardRedrawUntilBuilt", () => {
  it("skips a redraw until Tabulator has built the table, then lets it through", () => {
    const { View, inner } = fakeView();
    const redraw = inner.redraw;
    guardRedrawUntilBuilt(View.prototype);
    const view = new View();
    view.observeContainerResize();

    view.tabulatorTables?.redraw(true);
    expect(redraw).not.toHaveBeenCalled();

    inner.initialized = true;
    view.tabulatorTables?.redraw(true);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(redraw).toHaveBeenCalledWith(true);
  });

  it("guards each table a refresh builds, once", () => {
    const { View, inner } = fakeView();
    const redraw = inner.redraw;
    guardRedrawUntilBuilt(View.prototype);
    guardRedrawUntilBuilt(View.prototype);
    const view = new View();
    view.observeContainerResize();
    view.observeContainerResize();
    inner.initialized = true;
    view.tabulatorTables?.redraw();
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the library has no observeContainerResize", () => {
    const proto = {};
    guardRedrawUntilBuilt(proto);
    expect(proto).toEqual({});
  });
});
