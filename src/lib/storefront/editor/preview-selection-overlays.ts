import {
  INLINE_EDIT_OUTSET_PX,
  isSelectionOverlayTextFallbackCandidate,
  outsetOverlayBounds,
  selectionOverlayGeometry,
  type SelectionOverlayBounds,
} from "./selection-overlay-geometry";
import type { SelectionKind } from "./selection-taxonomy";

/**
 * The blue ring the editor draws around what is selected, and the dashed one
 * that follows the pointer.
 *
 * Owned here rather than by whichever preview happens to be rendering,
 * because the two previews must not disagree about what is highlighted or
 * where its edge is. Everything it needs arrives as state on each call: it
 * holds the elements it created and nothing else, so it has no opinion about
 * how selection is tracked.
 */

export type PreviewOverlayItem = Readonly<{
  element: HTMLElement;
  label: string;
  tagName: string;
  /**
   * Supplied rather than derived, so deciding what kind of thing is selected
   * stays with selection and this stays about drawing.
   */
  kind: SelectionKind;
}>;

export type PreviewOverlayState = Readonly<{
  /** Off means neither ring is drawn, whatever else is true. */
  enabled: boolean;
  selected: PreviewOverlayItem | null;
  hovered: PreviewOverlayItem | null;
  /**
   * The selection is mid-settle, so its ring is held where it is rather than
   * chased across a layout that is still moving.
   */
  selectedFrozen: boolean;
  /** Inline editing needs a little more room around the text it edits. */
  inlineEditing: boolean;
}>;

export type PreviewSelectionOverlays = Readonly<{
  /** Exposed so the reorder gesture can be attached by whoever owns it. */
  dragHandle: HTMLElement;
  setDragHandle(visible: boolean, title?: string): void;
  position(state: PreviewOverlayState): void;
  dispose(): void;
}>;

export function createPreviewSelectionOverlays(): PreviewSelectionOverlays {
  // 1. Persistent Selected Overlay (Solid 2px border, Glow ring, Bold badge)
  const selectedOverlay = document.createElement("div");
  selectedOverlay.setAttribute("aria-hidden", "true");
  Object.assign(selectedOverlay.style, {
    position: "fixed",
    zIndex: "2147483646",
    display: "none",
    pointerEvents: "none",
    border: "2px solid hsl(217 91% 60%)",
    boxShadow: "0 0 0 3px hsl(217 91% 60% / 0.18)",
    boxSizing: "border-box",
    borderRadius: "3px",
  });

  const selectedLabel = document.createElement("span");
  Object.assign(selectedLabel.style, {
    position: "absolute",
    left: "-2px",
    bottom: "100%",
    display: "inline-flex",
    alignItems: "baseline",
    gap: "5px",
    padding: "3px 7px",
    borderRadius: "4px 4px 0 0",
    background: "hsl(217 91% 60%)",
    color: "white",
    font: "600 11px/1.2 ui-sans-serif, system-ui, sans-serif",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  });
  const selectedLabelName = document.createElement("span");
  const selectedLabelTag = document.createElement("span");
  const selectedDragHandle = document.createElement("span");
  selectedDragHandle.dataset.storefrontEditorDragHandle = "true";
  selectedDragHandle.draggable = true;
  selectedDragHandle.title = "Drag to reorder";
  Object.assign(selectedDragHandle.style, {
    display: "none",
    gridTemplateColumns: "repeat(2, 2px)",
    gridAutoRows: "2px",
    gap: "2px",
    alignSelf: "center",
    flex: "0 0 auto",
    width: "14px",
    height: "14px",
    margin: "-2px 0 -2px -3px",
    padding: "2px 3px",
    border: "0",
    borderRadius: "3px",
    background: "transparent",
    color: "inherit",
    pointerEvents: "auto",
  });
  for (let index = 0; index < 6; index += 1) {
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "2px",
      height: "2px",
      borderRadius: "999px",
      background: "currentColor",
      opacity: "0.78",
      pointerEvents: "none",
    });
    selectedDragHandle.appendChild(dot);
  }
  Object.assign(selectedLabelTag.style, {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.86em",
    fontWeight: "500",
    opacity: "0.72",
  });
  selectedLabel.appendChild(selectedDragHandle);
  selectedLabel.appendChild(selectedLabelName);
  selectedLabel.appendChild(selectedLabelTag);
  selectedOverlay.appendChild(selectedLabel);

  document.body.appendChild(selectedOverlay);

  // 2. Hover Overlay (1.5px dashed border, Light blue transparent mask, Subtle badge)
  const hoverOverlay = document.createElement("div");
  hoverOverlay.setAttribute("aria-hidden", "true");
  Object.assign(hoverOverlay.style, {
    position: "fixed",
    zIndex: "2147483645",
    display: "none",
    pointerEvents: "none",
    border: "1.5px dashed hsl(217 91% 60% / 0.85)",
    background: "hsl(217 91% 60% / 0.08)",
    boxSizing: "border-box",
    borderRadius: "3px",
  });

  const hoverLabel = document.createElement("span");
  Object.assign(hoverLabel.style, {
    position: "absolute",
    left: "-1.5px",
    bottom: "100%",
    display: "inline-flex",
    alignItems: "baseline",
    gap: "4px",
    padding: "2px 6px",
    borderRadius: "3px 3px 0 0",
    background: "hsl(217 91% 60% / 0.85)",
    color: "white",
    font: "500 10px/1.2 ui-sans-serif, system-ui, sans-serif",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  });
  const hoverLabelName = document.createElement("span");
  const hoverLabelTag = document.createElement("span");
  Object.assign(hoverLabelTag.style, {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.86em",
    fontWeight: "500",
    opacity: "0.68",
  });
  hoverLabel.appendChild(hoverLabelName);
  hoverLabel.appendChild(hoverLabelTag);
  hoverOverlay.appendChild(hoverLabel);
  document.body.appendChild(hoverOverlay);

  const updateOverlayLabel = (
    nameElement: HTMLElement,
    tagElement: HTMLElement,
    item: PreviewOverlayItem,
  ) => {
    nameElement.textContent = item.label;
    tagElement.textContent = `<${item.tagName}>`;
  };

  return {
    dragHandle: selectedDragHandle,
    setDragHandle(visible, title) {
      selectedDragHandle.style.display = visible ? "inline-grid" : "none";
      if (title) selectedDragHandle.title = title;
    },
    position(state: PreviewOverlayState) {
      if (!state.enabled) {
        hoverOverlay.style.display = "none";
        selectedOverlay.style.display = "none";
        return;
      }

      // Measure every target before mutating either overlay. Keeping the reads
      // together avoids a selected-overlay write forcing the following hover
      // measurement to synchronously recalculate layout.
      const selectedElementForOverlay = state.selected?.element ?? null;
      const selectedRawBounds =
        selectedElementForOverlay &&
        !state.selectedFrozen &&
        document.body.contains(selectedElementForOverlay)
          ? selectedElementForOverlay.getBoundingClientRect()
          : null;
      const hoverElementForOverlay = state.hovered?.element ?? null;
      const hoverRawBounds =
        hoverElementForOverlay &&
        document.body.contains(hoverElementForOverlay) &&
        hoverElementForOverlay !== selectedElementForOverlay
          ? hoverElementForOverlay.getBoundingClientRect()
          : null;

      const resolveOverlayGeometry = (
        item: PreviewOverlayItem | null,
        element: HTMLElement | null,
        bounds: SelectionOverlayBounds | null,
      ) => {
        if (!item || !element || !bounds) return null;
        const candidate = {
          bounds,
          kind: item.kind,
          content: element.textContent ?? "",
          inlineHeight: element.style.height,
          inlineMaxHeight: element.style.maxHeight,
        };
        if (!isSelectionOverlayTextFallbackCandidate(candidate)) return bounds;
        const computed = window.getComputedStyle(element);
        return selectionOverlayGeometry({
          ...candidate,
          lineHeight: computed.lineHeight,
          fontSize: computed.fontSize,
          display: computed.display,
        });
      };
      const selectedBounds = resolveOverlayGeometry(
        state.selected,
        selectedElementForOverlay,
        selectedRawBounds,
      );
      const hoverBounds = resolveOverlayGeometry(
        state.hovered,
        hoverElementForOverlay,
        hoverRawBounds,
      );

      // Keep the last stable selected geometry while live authoring replaces
      // the selected DOM node. The settled pass below rebinds its identity and
      // measures the final element once.
      if (state.selected && state.selectedFrozen) {
        selectedOverlay.style.display = "block";
        updateOverlayLabel(selectedLabelName, selectedLabelTag, state.selected);
      } else if (state.selected && selectedBounds) {
        const ring = outsetOverlayBounds(
          selectedBounds,
          state.inlineEditing ? INLINE_EDIT_OUTSET_PX : undefined,
        );
        selectedOverlay.style.display = "block";
        selectedOverlay.style.left = `${ring.left}px`;
        selectedOverlay.style.top = `${ring.top}px`;
        selectedOverlay.style.width = `${ring.width}px`;
        selectedOverlay.style.height = `${ring.height}px`;
        updateOverlayLabel(selectedLabelName, selectedLabelTag, state.selected);
      } else {
        selectedOverlay.style.display = "none";
      }

      // 2. Position Hover Overlay (dashed + mask, hidden if hovering over selected item)
      if (state.hovered && hoverBounds) {
        const ring = outsetOverlayBounds(hoverBounds);
        hoverOverlay.style.display = "block";
        hoverOverlay.style.left = `${ring.left}px`;
        hoverOverlay.style.top = `${ring.top}px`;
        hoverOverlay.style.width = `${ring.width}px`;
        hoverOverlay.style.height = `${ring.height}px`;
        updateOverlayLabel(hoverLabelName, hoverLabelTag, state.hovered);
      } else {
        hoverOverlay.style.display = "none";
      }
    },
    dispose() {
      selectedOverlay.remove();
      hoverOverlay.remove();
    },
  };
}
