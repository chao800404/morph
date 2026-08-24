import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createSelectionRestoreMessages,
  EditorModeSurface,
} from "./visual-editor-shell";

describe("EditorModeSurface", () => {
  it("keeps both surfaces in the layout and preserves child identity across mode changes", () => {
    const { rerender } = render(
      <div className="grid">
        <EditorModeSurface active className="design-surface">
          <iframe data-testid="preview-frame" title="Preview" />
        </EditorModeSurface>
        <EditorModeSurface active={false} className="code-surface">
          <div data-testid="code-content" />
        </EditorModeSurface>
      </div>,
    );

    const frame = screen.getByTestId("preview-frame");
    const surfaces = document.querySelectorAll("[data-editor-mode-surface]");
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0].classList.contains("hidden")).toBe(false);
    expect(surfaces[1].classList.contains("hidden")).toBe(false);
    expect(surfaces[0].getAttribute("aria-hidden")).toBe("false");
    expect(surfaces[1].getAttribute("aria-hidden")).toBe("true");
    expect(surfaces[1].classList.contains("invisible")).toBe(true);
    expect(surfaces[1].classList.contains("pointer-events-none")).toBe(true);

    rerender(
      <div className="grid">
        <EditorModeSurface active={false} className="design-surface">
          <iframe data-testid="preview-frame" title="Preview" />
        </EditorModeSurface>
        <EditorModeSurface active className="code-surface">
          <div data-testid="code-content" />
        </EditorModeSurface>
      </div>,
    );

    expect(screen.getByTestId("preview-frame")).toBe(frame);
    expect(surfaces[0].getAttribute("aria-hidden")).toBe("true");
    expect(surfaces[1].getAttribute("aria-hidden")).toBe("false");
  });
});

describe("Code to Design selection restore", () => {
  it("posts selection mode restore followed by style refresh without remounting the preview", () => {
    const target = {
      sectionId: "hero",
      nodeId: "hero-heading",
      fieldPath: "heading",
      elementKey: "heading",
      fieldKey: "heading",
      isSection: false,
    } as const;

    expect(createSelectionRestoreMessages(true, target)).toEqual([
      {
        type: "morph:storefront-preview-set-selection-mode",
        enabled: true,
        restoreTarget: target,
      },
      { type: "morph:storefront-preview-request-selection-style" },
    ]);
    expect(createSelectionRestoreMessages(false, target)).toEqual([
      {
        type: "morph:storefront-preview-set-selection-mode",
        enabled: false,
        restoreTarget: undefined,
      },
    ]);
  });
});
