import { beforeAll, describe, expect, it } from "vitest";
import {
  collectEditableDescendantFields,
  collectPreviewEditableNodes,
  closestPreviewSectionRoot,
  previewSectionIdOf,
  previewSectionSelector,
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
      { fieldKey: "heading", fieldPath: "heading", sectionId: null },
      { fieldKey: "description", fieldPath: "description", sectionId: null },
      { fieldKey: "actionLabel", fieldPath: "actionLabel", sectionId: null },
    ]);
  });

  it("says which section each field belongs to", () => {
    // A selected parent can span several sections, and two instances of one
    // component expose the same field names. Without the owning section,
    // editing one would write to whichever came first.
    const parent = document.createElement("main");
    parent.innerHTML = `
      <section data-storefront-section-id="promo-a">
        <h2 data-storefront-field="heading" data-storefront-field-path="heading"></h2>
      </section>
      <section data-storefront-section-id="promo-b">
        <h2 data-storefront-field="heading" data-storefront-field-path="heading"></h2>
      </section>
    `;

    expect(collectEditableDescendantFields(parent)).toEqual([
      { fieldKey: "heading", fieldPath: "heading", sectionId: "promo-a" },
      { fieldKey: "heading", fieldPath: "heading", sectionId: "promo-b" },
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

describe("source-authored section roots", () => {
  it("selects a component that only declares data-morph-section", () => {
    // A component added purely in code has no Document section and is not
    // registered in the manifest, so nothing injects
    // `data-storefront-section-id`. Its own authored marker must be enough or
    // the component renders but can never be selected.
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-morph-section="promo" data-morph-node="promo-root">
        <h2 data-morph-node="promo-heading" data-morph-element="heading"></h2>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    const heading = nodes.find((node) => node.target.nodeId === "promo-heading");

    expect(nodes.length).toBeGreaterThan(0);
    expect(heading).toBeTruthy();
    expect(heading?.sectionId).toBe("promo");
  });

  it("prefers the Document section id when a component carries both markers", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="starter-hero" data-morph-section="hero">
        <h1 data-morph-node="hero-heading" data-morph-element="heading"></h1>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(nodes[0]?.sectionId).toBe("starter-hero");
  });

  it("does not treat a nested component as a second section", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="outer">
        <div data-morph-section="inner">
          <h2 data-morph-node="inner-heading" data-morph-element="heading"></h2>
        </div>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(new Set(nodes.map((node) => node.sectionId))).toEqual(
      new Set(["outer"]),
    );
  });
});

describe("component-root sections", () => {
  it("selects a component that has no authored markers at all", () => {
    // What a customer hits writing their own component: nothing registers it
    // and they added no data-morph-* attributes. The renderer's component-root
    // marker plus the interpreted source position must be enough.
    const root = document.createElement("main");
    root.innerHTML = `
      <main data-morph-component="HomeRoute" data-morph-source-file="src/routes/index.tsx">
        <section data-morph-component="Promo" data-morph-source-file="src/components/Promo.tsx" data-morph-loc="src/components/Promo.tsx:11:5">
          <h2 data-morph-loc="src/components/Promo.tsx:12:7"></h2>
        </section>
      </main>
    `;

    const nodes = collectPreviewEditableNodes(root);
    const heading = nodes.find(
      (node) => node.target.sourceLocation === "src/components/Promo.tsx:12:7",
    );

    expect(heading).toBeTruthy();
    expect(heading?.sectionId).toBe("src/components/Promo.tsx");
  });

  it("does not let a route's own markup absorb the components inside it", () => {
    // A route element is a component root too. If nesting were flattened to
    // the outermost root, every component below it would vanish.
    const root = document.createElement("main");
    root.innerHTML = `
      <main data-morph-component="HomeRoute" data-morph-source-file="src/routes/index.tsx">
        <section data-morph-component="Hero" data-morph-section="hero">
          <h1 data-morph-node="hero-heading"></h1>
        </section>
        <section data-morph-component="Promo" data-morph-source-file="src/components/Promo.tsx">
          <h2 data-morph-loc="src/components/Promo.tsx:12:7"></h2>
        </section>
      </main>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(new Set(nodes.map((node) => node.sectionId))).toEqual(
      new Set(["hero", "src/components/Promo.tsx"]),
    );
  });

  it("keeps authored markers authoritative when both are present", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-morph-component="Hero" data-morph-section="hero" data-morph-source-file="src/components/Hero.tsx">
        <h1 data-morph-node="hero-heading" data-morph-loc="src/components/Hero.tsx:10:7"></h1>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(nodes.find((node) => node.target.nodeId === "hero-heading")?.sectionId).toBe(
      "hero",
    );
  });

  it("skips a duplicated source position rather than guessing which one", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-morph-component="List" data-morph-source-file="src/components/List.tsx">
        <li data-morph-loc="src/components/List.tsx:7:9"></li>
        <li data-morph-loc="src/components/List.tsx:7:9"></li>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(
      nodes.filter(
        (node) => node.target.sourceLocation === "src/components/List.tsx:7:9",
      ),
    ).toHaveLength(0);
  });
});

describe("clicking an unmarked component", () => {
  function promoDom() {
    const root = document.createElement("main");
    root.innerHTML = `
      <main data-morph-component="HomeRoute" data-morph-source-file="src/routes/index.tsx">
        <section data-morph-component="Promo" data-morph-source-file="src/components/Promo.tsx" data-morph-loc="src/components/Promo.tsx:11:5">
          <h2 data-morph-loc="src/components/Promo.tsx:12:7">Promo</h2>
        </section>
      </main>
    `;
    return root;
  }

  it("resolves the section of an element that has only a source position", () => {
    // The click path used to require data-morph-node or data-morph-element, so
    // a component written without markers could be rendered but never clicked.
    const root = promoDom();
    const heading = root.querySelector<HTMLElement>("h2")!;
    const sectionEl = closestPreviewSectionRoot(heading);

    expect(sectionEl).toBeTruthy();
    expect(previewSectionIdOf(sectionEl!)).toBe("src/components/Promo.tsx");
  });

  it("finds that section again by the id the click reported", () => {
    // Collection, click and restore each resolve sections independently; if the
    // lookup cannot match the reported id, selection silently does nothing.
    const root = promoDom();
    const sectionId = "src/components/Promo.tsx";
    expect(root.querySelector(previewSectionSelector(sectionId))).toBeTruthy();
  });

  it("keeps matching sections identified by authored markers", () => {
    const root = document.createElement("main");
    root.innerHTML = `<section data-morph-section="hero"></section>`;
    expect(root.querySelector(previewSectionSelector("hero"))).toBeTruthy();
  });
});
