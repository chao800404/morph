import { beforeAll, describe, expect, it } from "vitest";
import {
  collectEditableDescendantFields,
  collectPreviewEditableNodes,
  resolvePreviewSelectionRestoreElement,
  selectionStyleSnapshot,
} from "./preview";

describe("preview selection style snapshot", () => {
  it("captures every computed value consumed by Margin, Fill, and Border", () => {
    const snapshot = selectionStyleSnapshot({
      marginTop: "24px",
      marginBottom: "8px",
      marginLeft: "auto",
      marginRight: "auto",
      color: "rgb(28, 25, 23)",
      borderTopLeftRadius: "2px",
      borderTopRightRadius: "4px",
      borderBottomRightRadius: "6px",
      borderBottomLeftRadius: "8px",
      borderTopWidth: "1px",
      borderTopStyle: "solid",
      borderTopColor: "rgb(120, 113, 108)",
    } as CSSStyleDeclaration);

    expect(snapshot).toMatchObject({
      marginTop: "24px",
      marginBottom: "8px",
      marginLeft: "auto",
      marginRight: "auto",
      color: "rgb(28, 25, 23)",
      borderTopLeftRadius: "2px",
      borderTopRightRadius: "4px",
      borderBottomRightRadius: "6px",
      borderBottomLeftRadius: "8px",
      borderTopWidth: "1px",
      borderTopStyle: "solid",
      borderTopColor: "rgb(120, 113, 108)",
    });
  });
});

describe("preview selection restore", () => {
  beforeAll(() => {
    Object.defineProperty(window, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value.replace(/"/g, '\\"') },
    });
  });

  it("restores an exact node and field path pair before broader identities", () => {
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
        fieldPath: "path",
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

  it("uses the field path to distinguish repeated instances of one source node", () => {
    const section = document.createElement("section");
    section.innerHTML = `
      <h2 data-morph-node="item-title" data-storefront-field-path="items.0.title"></h2>
      <h2 data-morph-node="item-title" data-storefront-field-path="items.1.title"></h2>
    `;

    expect(
      resolvePreviewSelectionRestoreElement(section, {
        sectionId: "principles",
        nodeId: "item-title",
        fieldPath: "items.1.title",
      }),
    ).toBe(
      section.querySelector('[data-storefront-field-path="items.1.title"]'),
    );
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
    expect(section.querySelector("[data-storefront-editor-selected]")).toBe(
      next,
    );
  });
});

describe("preview parent field discovery", () => {
  it("returns only unique editable leaf fields inside the selected parent", () => {
    const parent = document.createElement("div");
    parent.dataset.storefrontField = "content";
    parent.innerHTML = `
      <div data-storefront-field="group">
        <h1 data-storefront-field="heading" data-storefront-field-path="heading"></h1>
        <p data-storefront-field="description" data-storefront-field-path="description"></p>
      </div>
      <a data-storefront-field="actionLabel" data-storefront-field-path="actionLabel"></a>
      <span data-storefront-field="heading" data-storefront-field-path="heading"></span>
    `;

    expect(collectEditableDescendantFields(parent)).toEqual([
      { fieldKey: "heading", fieldPath: "heading" },
      { fieldKey: "description", fieldPath: "description" },
      { fieldKey: "actionLabel", fieldPath: "actionLabel" },
    ]);
  });
});

describe("preview editable structure", () => {
  it("collects stable hierarchy, excludes ambiguous fields, and keeps repeater item ids stable", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="principles">
        <div data-morph-node="content" data-morph-element="container">
          <p data-morph-node="label" data-morph-element="label" data-storefront-field="label"></p>
        </div>
        <article data-storefront-item-id="item-a" data-morph-node="card" data-morph-element="principle-card" data-storefront-field="items" data-storefront-field-path="items.0">
          <h2 data-morph-node="title" data-morph-element="heading" data-storefront-field="title" data-storefront-field-path="items.0.title"></h2>
        </article>
        <article data-storefront-item-id="item-b" data-morph-node="card" data-morph-element="principle-card" data-storefront-field="items" data-storefront-field-path="items.1"></article>
        <span data-storefront-field="ambiguous"></span>
        <span data-storefront-field="ambiguous"></span>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    const content = nodes.find((node) => node.label === "Container");
    const label = nodes.find((node) => node.label === "Label");
    const firstCard = nodes.find((node) => node.label === "Principle card 1");
    const title = nodes.find(
      (node) => node.target.fieldPath === "items.0.title",
    );

    expect(content).toBeTruthy();
    expect(content?.tagName).toBe("div");
    expect(label?.parentId).toBe(content?.id);
    expect(firstCard?.id).toContain("item:item-a:node:card");
    expect(title?.parentId).toBe(firstCard?.id);
    expect(title?.tagName).toBe("h2");
    expect(nodes.some((node) => node.label === "Ambiguous")).toBe(false);
  });
});
