import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TableView } from "./TableView";

// Tabulator builds no columns in jsdom (no layout), so the private columns are covered by
// `withoutQuestions` (publicDefinition.test.ts) and the browser tests; the menu is built at render.
// jsdom has no canvas; the library only measures text with it.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

const definition = {
  elements: [
    { type: "text", name: "q1" },
    { type: "text", name: "q2" },
  ],
};
const responses = [{ submittedAt: "2026-01-01T00:01:00.000Z", data: { q1: "a" } }];

function renderTable(publicView: boolean) {
  return render(
    <TableView
      surveyId="s"
      definition={definition}
      responses={responses}
      savedState={null}
      privateQuestions={["q2"]}
      publicView={publicView}
    />,
  );
}

describe("the Table", () => {
  it("offers the Export menu on the private page", () => {
    const { container } = renderTable(false);
    expect(container.querySelector(".sa-tabulator__downloads-bar")).not.toBeNull();
  });

  it("offers no Export menu on the public page", () => {
    const { container } = renderTable(true);
    expect(container.querySelector(".sa-tabulator__downloads-bar")).toBeNull();
    expect(container.textContent).not.toContain("Export as");
  });
});
