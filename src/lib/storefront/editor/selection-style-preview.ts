export const SELECTION_STYLE_APPLIED_EVENT =
  "morph:storefront-preview-selection-style-applied";

const ALLOWED_SELECTION_STYLE_PROPERTIES = new Set([
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "font-size",
  "line-height",
  "border-radius",
  "background-color",
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

type InlineStyleSnapshot = {
  value: string;
  priority: string;
};

export type SelectionStylePreview = ReturnType<
  typeof createSelectionStylePreview
>;

export function createSelectionStylePreview() {
  let target: HTMLElement | null = null;
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
    restore,
  };
}
