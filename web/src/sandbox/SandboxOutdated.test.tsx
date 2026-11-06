import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SandboxOutdated } from "./SandboxOutdated";

describe("SandboxOutdated", () => {
  it("explains and offers a reset", () => {
    const onReset = vi.fn();
    render(<SandboxOutdated onReset={onReset} />);
    expect(screen.getByRole("heading", { name: "This demo has been updated" })).toBeTruthy();
    expect(
      screen.getByText(
        "Your demo data was saved by another version of this demo and cannot be opened by this one. Reset it to continue with the new demo data.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset to continue" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
