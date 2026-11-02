export const SELECTION_STYLE_APPLIED_EVENT =
  "morph:storefront-preview-selection-style-applied";

const ALLOWED_SELECTION_STYLE_PROPERTIES = new Set([
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "font-size",
  "line-height",
  "border-width",
  "border-top-width",
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-style",
  "border-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "color",
  "background-color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "text-align",
  "font-family",
  "font-weight",
  "object-position",
  "object-fit",
  "aspect-ratio",
  // Figma-like inspector rule: continuous controls preview these properties
  // directly on the selected DOM node and persist only after input completes.
  "display",
  "flex-direction",
  "gap",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "rotate",
  "opacity",
  "overflow",
  "align-items",
  "justify-content",
]);

const PAINT_ONLY_SELECTION_STYLE_PROPERTIES = new Set([
  "color",
  "border-color",
  "background-color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
]);

export function selectionStylePreviewNeedsOverlayUpdate(
  styles: Record<string, string>,
) {
  return Object.keys(styles).some(
    (property) => !PAINT_ONLY_SELECTION_STYLE_PROPERTIES.has(property),
  );
}

type InlineStyleSnapshot = {
  value: string;
  priority: string;
};

export type SelectionStylePreview = ReturnType<
  typeof createSelectionStylePreview
>;

/**
 * Drag-time inline styles on the selected element.
 *
 * A control previews its value directly on the DOM node while it is being
 * dragged, then the edit is written to source and the component re-renders with
 * a new element. The previewed styles are remembered so they can be carried
 * onto that new element: dropping them in the same frame exposes the old value
 * until the generated stylesheet rule for the new class exists.
 *
 * The remembered styles and the applied ones are owned together here. They were
 * separate before — a map in the preview route and the inline styles in this
 * module — and one code path cleared only the inline styles, so the next
 * re-render put the previewed value straight back. Reversing an edit is exactly
 * such a re-render, which is how that showed up as "undo does nothing".
 */
export function createSelectionStylePreview() {
  let target: HTMLElement | null = null;
  let pending: Record<string, string> | null = null;
  const originalStyles = new Map<string, InlineStyleSnapshot>();

  const restore = () => {
    if (target) {
      for (const [property, original] of originalStyles) {
        if (original.value) {
          target.style.setProperty(property, original.value, original.priority);
        } else {
          target.style.removeProperty(property);
        }
      }
    }
    target = null;
    originalStyles.clear();
  };

  return {
    apply(element: HTMLElement, styles: Record<string, string>) {
      if (target && target !== element) restore();
      target = element;
      pending = { ...(pending ?? {}), ...styles };

      for (const [property, value] of Object.entries(styles)) {
        if (
          !ALLOWED_SELECTION_STYLE_PROPERTIES.has(property) ||
          typeof value !== "string" ||
          value.length > 100
        ) {
          continue;
        }
        if (!originalStyles.has(property)) {
          originalStyles.set(property, {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property),
          });
        }
        element.style.setProperty(property, value);
      }
    },

    /**
     * Re-applies the remembered styles to the element a re-render produced.
     *
     * Without this the value visibly returns to what it was until the new
     * class's stylesheet rule exists, so a single edit appears to move twice.
     */
    carryTo(element: HTMLElement) {
      if (!pending) return;
      this.apply(element, pending);
    },

    /** Whether anything is waiting to be carried across a re-render. */
    hasPending() {
      return pending !== null;
    },

    /**
     * Pins the element's current appearance so it survives a recompile.
     *
     * The generated stylesheet is compiled from the theme source and lands
     * after the DOM already carries the new class, so between the two the
     * element has a class no rule matches and falls back to its unstyled size.
     * A live drag hides that gap behind the value it is previewing; an edit
     * applied without one — reversing a change, for instance — shows it as a
     * visible jump to the unstyled value and back.
     *
     * Recorded as pending like any other preview, because the edit replaces the
     * element: held styles left on the old node would vanish with it, which is
     * the gap this is meant to cover.
     */
    holdCurrentStyles(element: HTMLElement) {
      const computed = getComputedStyle(element);
      const held: Record<string, string> = {};
      for (const property of ALLOWED_SELECTION_STYLE_PROPERTIES) {
        const value = computed.getPropertyValue(property);
        if (value) held[property] = value;
      }
      this.apply(element, held);
    },

    /**
     * Restores the element and forgets what was previewed.
     *
     * The two must happen together: keeping the remembered styles would let the
     * next re-render re-apply what was just dropped.
     */
    clear() {
      pending = null;
      restore();
    },

    restore,
  };
}
