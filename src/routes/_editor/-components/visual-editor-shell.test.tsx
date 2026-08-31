import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createSelectionRestoreMessages,
  EditorCodeModeSurface,
  EditorModeSurface,
} from "./visual-editor-shell";

describe("EditorModeSurface", () => {
  it("keeps both surfaces mounted while hiding and isolating the inactive one", () => {
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
    expect(surfaces[0].classList.contains("opacity-100")).toBe(true);
    expect(surfaces[0].classList.contains("z-10")).toBe(true);
    expect(surfaces[1].classList.contains("invisible")).toBe(true);
    expect(surfaces[1].classList.contains("opacity-0")).toBe(true);
    expect(surfaces[1].classList.contains("z-0")).toBe(true);
    expect(surfaces[1].hasAttribute("hidden")).toBe(false);
    expect(surfaces[0].getAttribute("aria-hidden")).toBe("false");
    expect(surfaces[1].getAttribute("aria-hidden")).toBe("true");
    expect(surfaces[1].hasAttribute("inert")).toBe(true);
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
    expect(surfaces[0].classList.contains("invisible")).toBe(true);
    expect(surfaces[0].classList.contains("opacity-0")).toBe(true);
    expect(surfaces[0].classList.contains("z-0")).toBe(true);
    expect(surfaces[0].hasAttribute("hidden")).toBe(false);
    expect(surfaces[1].classList.contains("invisible")).toBe(false);
    expect(surfaces[1].classList.contains("opacity-100")).toBe(true);
    expect(surfaces[1].classList.contains("z-10")).toBe(true);
    expect(surfaces[1].hasAttribute("hidden")).toBe(false);
    expect(surfaces[0].hasAttribute("inert")).toBe(true);
    expect(surfaces[1].hasAttribute("inert")).toBe(false);
    expect(surfaces[0].getAttribute("aria-hidden")).toBe("true");
    expect(surfaces[1].getAttribute("aria-hidden")).toBe("false");
  });
});

describe("EditorCodeModeSurface", () => {
  it("mounts on first activation and preserves the same subtree afterwards", () => {
    const { rerender } = render(
      <EditorCodeModeSurface active={false}>
        <textarea data-testid="code-buffer" defaultValue="draft" />
      </EditorCodeModeSurface>,
    );

    expect(screen.queryByTestId("code-buffer")).toBeNull();

    rerender(
      <EditorCodeModeSurface active>
        <textarea data-testid="code-buffer" defaultValue="draft" />
      </EditorCodeModeSurface>,
    );
    const buffer = screen.getByTestId("code-buffer") as HTMLTextAreaElement;
    buffer.value = "dirty draft";

    rerender(
      <EditorCodeModeSurface active={false}>
        <textarea data-testid="code-buffer" defaultValue="draft" />
      </EditorCodeModeSurface>,
    );

    expect(screen.getByTestId("code-buffer")).toBe(buffer);
    expect(buffer.value).toBe("dirty draft");
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

  it("carries the latest selection revision through a restore request", () => {
    const target = {
      sectionId: "hero",
      elementKey: "hero-image",
      isSection: false,
    } as const;

    expect(createSelectionRestoreMessages(true, target, 4)[0]).toMatchObject({
      type: "morph:storefront-preview-set-selection-mode",
      selectionRevision: 4,
    });
  });
});
