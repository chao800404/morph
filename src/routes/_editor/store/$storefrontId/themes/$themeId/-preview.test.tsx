import { beforeAll, describe, expect, it } from "vitest";
import { resolvePreviewSelectionRestoreElement } from "./preview";

describe("preview selection restore", () => {
  beforeAll(() => {
    Object.defineProperty(window, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value.replace(/"/g, "\\\"") },
    });
  });

  it("restores node, field path, element key, then field key in priority order", () => {
    const section = document.createElement("section");
    section.dataset.storefrontSectionId = "hero";
    section.innerHTML = `
      <div data-morph-node="node" data-storefront-field-path="path" data-morph-element="element" data-storefront-field="field"></div>
      <div data-storefront-field-path="path-only"></div>
      <div data-morph-element="element-only"></div>
      <div data-storefront-field="field-only"></div>
    `;

    expect(
      resolvePreviewSelectionRestoreElement(section, {
        sectionId: "hero",
        nodeId: "node",
        fieldPath: "path-only",
        elementKey: "element-only",
        fieldKey: "field-only",
      }),
    ).toBe(section.querySelector('[data-morph-node="node"]'));
    expect(
      resolvePreviewSelectionRestoreElement(section, {
        sectionId: "hero",
        fieldPath: "path-only",
        elementKey: "element-only",
        fieldKey: "field-only",
      }),
    ).toBe(section.querySelector('[data-storefront-field-path="path-only"]'));
    expect(
      resolvePreviewSelectionRestoreElement(section, {
        sectionId: "hero",
        elementKey: "element-only",
        fieldKey: "field-only",
      }),
    ).toBe(section.querySelector('[data-morph-element="element-only"]'));
    expect(
      resolvePreviewSelectionRestoreElement(section, {
        sectionId: "hero",
        fieldKey: "field-only",
      }),
    ).toBe(section.querySelector('[data-storefront-field="field-only"]'));
  });

  it("falls back to the section and supports selecting another child afterward", () => {
    const section = document.createElement("section");
    section.innerHTML = `<button data-morph-element="first"></button><button data-morph-element="second"></button>`;
    const target = resolvePreviewSelectionRestoreElement(section, {
      sectionId: "hero",
      elementKey: "missing",
    });
    expect(target).toBe(section);
    const next = section.querySelector<HTMLElement>(
      '[data-morph-element="second"]',
    );
    expect(next).not.toBeNull();
    next?.setAttribute("data-storefront-editor-selected", "true");
    expect(section.querySelector('[data-storefront-editor-selected]')).toBe(next);
  });
});
