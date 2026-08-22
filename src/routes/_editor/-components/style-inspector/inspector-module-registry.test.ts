import { describe, expect, it, vi } from "vitest";
import type { InspectorModuleId } from "@/lib/storefront/editor/inspector-modules";
import {
  hasInspectorDesignModule,
  INSPECTOR_DESIGN_MODULE_ORDER,
  INSPECTOR_DESIGN_MODULE_REGISTRY,
  renderInspectorDesignModule,
} from "./inspector-module-registry";

describe("inspector design module registry", () => {
  it("keeps every ordered module backed by a typed descriptor", () => {
    expect(Object.keys(INSPECTOR_DESIGN_MODULE_REGISTRY)).toEqual(
      INSPECTOR_DESIGN_MODULE_ORDER,
    );
  });

  it("renders only capabilities enabled for the selected DOM node", () => {
    const render = vi.fn(() => "Typography controls");
    const visible = new Set<InspectorModuleId>(["content", "typography"]);

    expect(hasInspectorDesignModule(visible)).toBe(true);
    expect(renderInspectorDesignModule("typography", visible, render)).toBe(
      "Typography controls",
    );
    expect(renderInspectorDesignModule("border", visible, render)).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does not create an empty Design card for special-only capabilities", () => {
    expect(
      hasInspectorDesignModule(
        new Set<InspectorModuleId>(["content", "source-style"]),
      ),
    ).toBe(false);
  });
});
