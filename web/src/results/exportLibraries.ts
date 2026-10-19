import type { jsPDF } from "jspdf";

// Where Tabulator looks for the libraries when a PDF or Excel download starts (its dependency
// registry falls back to these globals at download time).
declare global {
  interface Window {
    jspdf?: { jsPDF: typeof jsPDF };
    XLSX?: typeof import("xlsx");
  }
}

export type ExportType = "pdf" | "xlsx";

const loads = new Map<ExportType, Promise<void>>();

async function loadPdf(): Promise<void> {
  const [{ jsPDF }, { applyPlugin }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  applyPlugin(jsPDF);
  window.jspdf = { jsPDF };
}

async function loadXlsx(): Promise<void> {
  window.XLSX = await import("xlsx");
}

/**
 * Loads the library the table's PDF (jsPDF and its AutoTable plugin) or Excel (SheetJS) export
 * needs, once per type: they sit in their own chunk, which only the first such export fetches. A
 * failed load is forgotten, so the next export tries again.
 */
export function loadExportLibrary(type: ExportType): Promise<void> {
  let load = loads.get(type);
  if (load === undefined) {
    load = (type === "pdf" ? loadPdf() : loadXlsx()).catch((error: unknown) => {
      loads.delete(type);
      throw error;
    });
    loads.set(type, load);
  }
  return load;
}
