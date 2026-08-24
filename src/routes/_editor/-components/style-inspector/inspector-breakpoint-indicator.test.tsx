import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InspectorBreakpointIndicator,
  inspectorBreakpointLabel,
} from "./inspector-breakpoint-indicator";

describe("InspectorBreakpointIndicator", () => {
  it.each([
    ["mobile", "Base"],
    ["tablet", "md"],
    ["desktop", "lg"],
  ] as const)("maps %s to the active authored variant label", (viewport, label) => {
    expect(inspectorBreakpointLabel(viewport)).toBe(label);

    render(<InspectorBreakpointIndicator viewport={viewport} />);

    expect(
      screen.getByLabelText(`Editing ${label} breakpoint styles`).textContent,
    ).toBe(label);
  });
});
