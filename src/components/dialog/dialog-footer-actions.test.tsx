import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogFooterActions } from "./dialog-footer-actions";

describe("DialogFooterActions", () => {
  it("owns the shared right-aligned footer layout", () => {
    const { container } = render(
      <DialogFooterActions isSheet={false} onCancel={() => undefined} />,
    );

    const actions = container.firstElementChild;
    expect(actions?.className).toContain("w-full");
    expect(actions?.className).toContain("justify-end");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
