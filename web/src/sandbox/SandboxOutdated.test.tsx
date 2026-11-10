import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SandboxOutdated } from "./SandboxOutdated";
import { StorageFullError } from "./store";

describe("SandboxOutdated", () => {
  it("explains and offers a reset", () => {
    const onReset = vi.fn(() => Promise.resolve());
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

  it("says so when the reset is refused, and lets the visitor try again", async () => {
    const onReset = vi.fn(() => Promise.reject(new StorageFullError()));
    render(<SandboxOutdated onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset to continue" }));

    const message = await screen.findByText(
      "Could not reset the demo data. Try again, or clear this site's data in the browser and reload.",
    );
    expect(message.getAttribute("role")).toBe("alert");
    const button = screen.getByRole("button", { name: "Reset to continue" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
