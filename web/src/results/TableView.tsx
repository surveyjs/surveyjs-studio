import { useEffect, useRef, useState } from "react";
import { Tabulator } from "survey-analytics/survey.analytics.tabulator";
import "survey-analytics/survey.analytics.tabulator.css";
import { Model } from "survey-core";
import "tabulator-tables/dist/css/tabulator.min.css";
import type { ViewState } from "../api/views";
import { loadExportLibrary } from "./exportLibraries";
import type { ResultsWidgetProps } from "./ResultsPage";
import { extraTableColumns, tableRows } from "./tableRows";
import { type ElementsState, reconcileElementsState } from "./elementsState";
import { withoutQuestions } from "./publicDefinition";

type TableViewState = Tabulator["state"];

/**
 * The default state with the table-only columns (Submitted, IPAddress) after the answer columns.
 * The library sorts columns it adds from `columnsData` by their index in that list, which puts them
 * among the answer columns, so the page fixes their place itself.
 */
function defaultState(table: Tabulator, extraNames: ReadonlySet<string>): ElementsState {
  const state = table.state as unknown as ElementsState;
  const answers = state.elements.filter((element) => !extraNames.has(element.name));
  const extras = state.elements.filter((element) => extraNames.has(element.name));
  return { ...state, elements: [...answers, ...extras] };
}

/**
 * The Table tab: the SurveyJS Dashboard's Tabulator table with every response, the column chooser,
 * paging and the CSV, Excel and PDF downloads. This module is the only one that imports the table
 * and its styles, so the page loads them when the Table tab opens; the PDF and Excel libraries load
 * on the first such download. Built once per mount, with the saved state applied before it renders.
 */
export function TableView({
  definition,
  responses,
  savedState,
  onStateChange,
  privateQuestions,
  publicView = false,
}: ResultsWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const [exportFailed, setExportFailed] = useState(false);
  // The state at mount: later changes of the prop come from this widget itself.
  const initialState = useRef(savedState);
  const privateAtMount = useRef(privateQuestions);
  const stateCallback = useRef(onStateChange);
  useEffect(() => {
    stateCallback.current = onStateChange;
  }, [onStateChange]);

  // Built in the effect, not during render: Strict Mode runs effects twice, and the table holds
  // a Tabulator instance that only `destroy` releases.
  useEffect(() => {
    const target = container.current;
    if (target === null) return;
    let active = true;
    let rendered = false;
    // The public Table is built without the private questions (see withoutQuestions).
    const survey = new Model(
      publicView ? withoutQuestions(definition, privateAtMount.current) : definition,
    );
    const names = new Set(survey.getAllQuestions().map((question) => question.name));
    const extras = extraTableColumns(responses, names);
    const table = new Tabulator(
      survey,
      tableRows(responses, names),
      { downloadButtons: publicView ? [] : ["pdf", "xlsx", "csv"] },
      extras as unknown as ConstructorParameters<typeof Tabulator>[3],
    );
    const defaults = defaultState(table, new Set(extras.map((column) => column.name)));
    // Always set before render (no onStateChanged then): it also fills the extra columns' cells,
    // which the library leaves empty for columns it adds after reading the data.
    const state = reconcileElementsState(initialState.current, defaults) ?? defaults;
    table.lockStateChanged();
    table.state = state as unknown as TableViewState;
    table.unlockStateChanged();

    // CSV needs no library. PDF and Excel load theirs first; Tabulator looks them up when the
    // download starts.
    const download = table.download.bind(table);
    table.download = (type) => {
      if (type !== "pdf" && type !== "xlsx") {
        download(type);
        return;
      }
      setExportFailed(false);
      loadExportLibrary(type).then(
        () => {
          if (active) download(type);
        },
        () => {
          if (active) setExportFailed(true);
        },
      );
    };

    table.render(target);
    rendered = true;
    // The library has no option to leave the "Export as" menu out: an empty `downloadButtons`
    // list still builds it, so the public page removes it (render adds it synchronously).
    if (publicView) target.querySelector(".sa-tabulator__downloads-bar")?.remove();
    if (stateCallback.current !== undefined) {
      table.onStateChanged.add((_, changed: ViewState) => stateCallback.current?.(changed));
    }
    return () => {
      active = false;
      // The table cannot be destroyed before it rendered.
      if (rendered) table.destroy();
      survey.dispose();
    };
  }, [definition, responses, publicView]);

  return (
    <>
      {exportFailed && (
        <p className="v2-class---paragraph" role="alert">
          The export could not be prepared. Please try again.
        </p>
      )}
      <div ref={container} />
    </>
  );
}
