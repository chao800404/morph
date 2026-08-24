import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InspectorControlRow,
  inspectorControlRowClassName,
} from "./inspector-control-row";

describe("InspectorControlRow", () => {
  it("owns the shared surface and exposes every presentation slot", () => {
    render(
      <InspectorControlRow
        label="Padding"
        control={<input aria-label="Padding value" />}
        unit={<button type="button">px</button>}
        trailingAction={<button type="button">Expand</button>}
      />,
    );

    const row = screen
      .getByText("Padding")
      .closest('[data-slot="inspector-control-row"]');
    expect(row).toBeTruthy();
    expect(row?.className.split(" ")).toEqual(
      expect.arrayContaining([
        "h-8",
        "px-2",
        "border",
        "border-input",
        "bg-background",
        "rounded-md-plus",
        "focus-within:border-ring",
        "focus-within:ring-[3px]",
        "pr-0",
      ]),
    );
    expect(
      row?.querySelector('[data-slot="inspector-control-row-label"]'),
    )?.toHaveProperty("textContent", "Padding");
    expect(
      row?.querySelector('[data-inspector-control-row-slot="control"]'),
    ).toBe(screen.getByRole("textbox", { name: "Padding value" }));
    expect(
      row?.querySelector('[data-slot="inspector-control-row-unit"]'),
    )?.toHaveProperty("textContent", "px");
    expect(
      row?.querySelector('[data-slot="inspector-control-row-action"]'),
    )?.toHaveProperty("textContent", "Expand");
  });

  it("keeps the complete row contract in one exported class source", () => {
    expect(inspectorControlRowClassName.split(" ")).toEqual(
      expect.arrayContaining([
        "h-8",
        "px-2",
        "border-input",
        "bg-background",
        "rounded-md-plus",
        "focus-within:ring-ring/50",
      ]),
    );
  });

  it("can flush a trailing control without requiring a unit slot", () => {
    render(
      <InspectorControlRow
        label="Alignment"
        control={<div>Alignment buttons</div>}
        flushTrailing
      />,
    );

    expect(
      screen
        .getByText("Alignment")
        .closest('[data-slot="inspector-control-row"]')
        ?.className.split(" "),
    ).toContain("pr-0");
  });
});
