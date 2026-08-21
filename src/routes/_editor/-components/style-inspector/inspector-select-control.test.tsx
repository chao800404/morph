import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InspectorSelectControl } from "./inspector-select-control";

describe("InspectorSelectControl", () => {
  it("uses the compact Inspector menu density without crowding the selection indicator", async () => {
    render(
      <InspectorSelectControl
        label="Ratio"
        ariaLabel="Aspect ratio"
        value="auto"
        options={["auto", "1/1", "16/9"]}
        disabled={false}
        formatOption={(value) => (value === "auto" ? "Auto" : value)}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Ratio").className.split(" ")).toContain("text-xs");

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Aspect ratio" }), {
      key: "ArrowDown",
    });

    const autoOption = await screen.findByRole("option", { name: "Auto" });
    expect(autoOption.className.split(" ")).toEqual(
      expect.arrayContaining(["min-h-7", "pr-7", "text-xs"]),
    );
    expect(
      autoOption.closest('[data-slot="select-content"]')?.className.split(" "),
    ).toContain("min-w-24");
  });
});
