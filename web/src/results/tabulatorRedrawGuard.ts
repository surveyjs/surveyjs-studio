/**
 * A workaround for survey-analytics 3.2.5 (the Table view).
 *
 * Its `observeContainerResize` redraws the Tabulator table from a ResizeObserver, one animation
 * frame after the container's width changes. Tabulator builds a table in a `setTimeout` after its
 * constructor, and its `redraw` reads the header element, which is null until then: a width change
 * in that window (Firefox, while the results page lays out) throws "can't access property
 * offsetWidth" from a frame callback. Tabulator asks callers to wait for `tableBuilt`; the build
 * draws the table at the container's width anyway, so a redraw before it is skipped.
 *
 * Remove this once survey-analytics waits for the table to be built. When the library no longer
 * has `observeContainerResize`, this changes nothing.
 */

interface TabulatorTable {
  /** Tabulator sets this when the table is built (`tableBuilt`). */
  initialized?: boolean;
  redraw(force?: boolean): void;
}

interface TableViewInternals {
  tabulatorTables?: TabulatorTable | null;
  observeContainerResize?: (this: TableViewInternals) => void;
}

const GUARDED = Symbol("redraw guarded until built");

/** Wraps `observeContainerResize` on the Table view's prototype: each table it watches redraws only once built. */
export function guardRedrawUntilBuilt(prototype: object): void {
  const view = prototype as TableViewInternals & { [GUARDED]?: true };
  const observe = view.observeContainerResize;
  if (typeof observe !== "function" || view[GUARDED]) return;
  view[GUARDED] = true;
  view.observeContainerResize = function (this: TableViewInternals) {
    observe.call(this);
    const table = this.tabulatorTables as
      (TabulatorTable & { [GUARDED]?: true }) | null | undefined;
    if (!table || table[GUARDED]) return;
    table[GUARDED] = true;
    const redraw = table.redraw.bind(table);
    table.redraw = (force?: boolean) => {
      if (table.initialized) redraw(force);
    };
  };
}
