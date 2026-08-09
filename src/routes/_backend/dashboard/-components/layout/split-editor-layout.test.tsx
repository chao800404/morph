import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EDITOR_SIDEBAR_WIDTH, SplitEditorLayout } from "./split-editor-layout";

describe("SplitEditorLayout", () => {
  it("uses the shared fluid sidebar width and protects both columns", () => {
    const { container } = render(
      <SplitEditorLayout main={<p>preview</p>} sidebar={<p>controls</p>} />,
    );

    const main = container.querySelector("section");
    const sidebar = container.querySelector("aside");
    const split = container.firstElementChild;

    expect(split?.className).toContain("flex-1");
    expect(split?.className).toContain("h-full");
    expect(main?.className).toContain("min-w-0");
    expect(main?.className).toContain("flex-1");
    expect(sidebar?.className).toContain(EDITOR_SIDEBAR_WIDTH);
    expect(sidebar?.className).toContain("shrink-0");
    expect(sidebar?.className).toContain("min-h-0");
    expect(sidebar?.className).toContain("overflow-y-auto");
    expect(sidebar?.className).toContain("max-lg:w-full");
  });
});
