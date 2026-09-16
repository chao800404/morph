import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  collectPreviewEditableNodes,
  resolvePreviewSelectionRestoreElement,
  resolveSelectable,
} from "./preview-dom";

afterEach(() => {
  document.body.replaceChildren();
});

beforeAll(() => {
  if (typeof CSS === "undefined") {
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
  }
});

describe("preview section-root selection", () => {
  it("keeps a transparent document wrapper from resolving to the route root", () => {
    const route = document.createElement("main");
    route.dataset.morphComponent = "HomeRoute";
    route.dataset.morphSourceFile = "src/routes/index.tsx";
    route.dataset.morphLoc = "src/routes/index.tsx:16:5";

    const section = document.createElement("div");
    section.dataset.storefrontSectionId = "starter-introduction";
    section.style.display = "contents";
    route.appendChild(section);
    document.body.appendChild(route);

    const selected = resolveSelectable(section);

    expect(selected?.element).toBe(section);
    expect(selected?.section).toBe(section);
    expect(selected?.sectionId).toBe("starter-introduction");
    expect(selected?.type).toBe("section");
  });

  it("resolves the platform route marker as a selectable page root", () => {
    const previewRoot = document.createElement("div");
    previewRoot.dataset.storefrontPreviewRoot = "true";
    previewRoot.dataset.morphRoutePath = "/products";
    document.body.appendChild(previewRoot);

    const selected = resolveSelectable(previewRoot);

    expect(selected?.element).toBe(previewRoot);
    expect(selected?.section).toBe(previewRoot);
    expect(selected?.sectionId).toBe("/products");
    expect(selected?.type).toBe("page");
  });
});

describe("preview tree selection restore", () => {
  it("uses the requested source location instead of retaining a sibling", () => {
    const section = document.createElement("div");
    section.dataset.storefrontSectionId = "hero";
    section.innerHTML = `
      <div data-morph-loc="Hero.tsx:10:7">first</div>
      <div data-morph-loc="Hero.tsx:11:7">second</div>
    `;
    document.body.appendChild(section);

    const first = section.querySelector<HTMLElement>(
      '[data-morph-loc="Hero.tsx:10:7"]',
    );
    const second = section.querySelector<HTMLElement>(
      '[data-morph-loc="Hero.tsx:11:7"]',
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    const restored = resolvePreviewSelectionRestoreElement(
      section,
      {
        sectionId: "hero",
        sourceLocation: "Hero.tsx:11:7",
        isSection: false,
      },
      first,
    );

    expect(restored).toBe(second);
  });

  it("falls back to the retained element when code moved its source location", () => {
    const section = document.createElement("div");
    section.dataset.storefrontSectionId = "hero";
    section.innerHTML = '<div data-morph-loc="Hero.tsx:20:7">content</div>';
    document.body.appendChild(section);
    const retained = section.firstElementChild as HTMLElement;

    const restored = resolvePreviewSelectionRestoreElement(
      section,
      {
        sectionId: "hero",
        sourceLocation: "Hero.tsx:99:7",
        isSection: false,
      },
      retained,
    );

    expect(restored).toBe(retained);
  });
});

describe("preview editable node naming", () => {
  it("names an element by its tag, and says which one when it has an id", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="hero">
        <div id="hero-copy" data-morph-node="copy" data-morph-element="content">
          <h1 data-morph-node="heading" data-morph-element="heading">Title</h1>
        </div>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    const copy = nodes.find((node) => node.target.nodeId === "copy");
    const heading = nodes.find((node) => node.target.nodeId === "heading");

    // The tag says what it is and the id says which one, so one form covers a
    // named element and an unnamed one — and a reader can tell them apart.
    expect(copy?.label).toBe("Div#hero-copy");
    expect(copy?.htmlId).toBe("hero-copy");
    expect(heading?.label).toBe("H1");
    expect(heading?.htmlId).toBeUndefined();
  });

  it("does not use platform identity markers as display names", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="hero">
        <div data-morph-node="generated-node" data-morph-element="content"></div>
      </section>
    `;

    const node = collectPreviewEditableNodes(root)[0];
    expect(node?.label).toBe("Div");
    expect(node?.label).not.toContain("generated-node");
    expect(node?.htmlId).toBeUndefined();
  });
});

describe("preview-only row wrappers", () => {
  it("shows the rendered anchor instead of the compiler's wrapper", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="header">
        <nav data-morph-loc="src/Header.tsx:4:3">
          <div data-morph-preview-row-wrapper data-storefront-item-id="nav-1"
            data-storefront-field="items" data-storefront-field-path="items.0">
            <a data-morph-loc="src/Header.tsx:6:7" data-storefront-field="label"
              data-storefront-field-path="items.0.label">Home</a>
          </div>
        </nav>
      </section>
    `;

    const nodes = collectPreviewEditableNodes(root);
    expect(nodes.map((node) => node.label)).toEqual(["Nav", "A"]);
    const anchor = nodes.find((node) => node.tagName === "a");
    const nav = nodes.find((node) => node.tagName === "nav");
    expect(anchor?.parentId).toBe(nav?.id);
    expect(anchor?.target.fieldPath).toBe("items.0.label");
    expect(anchor?.id).toContain("item:nav-1");
  });

  it("keeps an authored display-contents element in the tree", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-storefront-section-id="hero">
        <div style="display: contents" data-morph-loc="src/Hero.tsx:3:3">
          <a data-morph-loc="src/Hero.tsx:4:5">Action</a>
        </div>
      </section>
    `;

    expect(collectPreviewEditableNodes(root).map((node) => node.label)).toEqual(
      ["Div", "A"],
    );
  });
});

describe("an authored id as an identity", () => {
  const collect = (html: string) => {
    const root = document.createElement("main");
    root.innerHTML = html;
    return collectPreviewEditableNodes(root);
  };

  // A position shifts the moment a line is added above it; an id does not.
  it("is preferred over the position the compiler derived", () => {
    const nodes = collect(`
      <section data-storefront-section-id="hero">
        <div id="hero-copy" data-morph-loc="src/Hero.tsx:12:5"></div>
      </section>
    `);
    const copy = nodes.find((node) => node.htmlId === "hero-copy");
    expect(copy?.id).toBe("hero:id:hero-copy");
    // Never the only one carried: the author can change or delete the id
    // between the selection and the restore.
    expect(copy?.target.htmlId).toBe("hero-copy");
    expect(copy?.target.sourceLocation).toBe("src/Hero.tsx:12:5");
  });

  /**
   * One component rendered twice writes the same id twice without anyone
   * asking for it, and a selection restored by a duplicate lands on whichever
   * twin the browser returned first.
   */
  it("is ignored when the document holds more than one of it", () => {
    const nodes = collect(`
      <section data-storefront-section-id="a">
        <div id="card" data-morph-loc="src/Card.tsx:3:1"></div>
      </section>
      <section data-storefront-section-id="b">
        <div id="card" data-morph-loc="src/Card.tsx:3:1"></div>
      </section>
    `);
    for (const node of nodes.filter((entry) => entry.htmlId === "card")) {
      expect(node.id).not.toContain("id:card");
      expect(node.target.htmlId).toBeUndefined();
    }
    // Still shown, because it is still what the author wrote on the element.
    expect(nodes.some((node) => node.label === "Div#card")).toBe(true);
  });

  // Duplicated once per row, so it is never the document's — the row-scoped
  // identity is what addresses these, and it stays.
  it("leaves a repeated field's rows addressed by their row", () => {
    const nodes = collect(`
      <section data-storefront-section-id="list">
        <div data-storefront-item-id="a" data-storefront-field-path="items.0">
          <span id="title" data-storefront-field="title"
            data-storefront-field-path="items.0.title">A</span>
        </div>
        <div data-storefront-item-id="b" data-storefront-field-path="items.1">
          <span id="title" data-storefront-field="title"
            data-storefront-field-path="items.1.title">B</span>
        </div>
      </section>
    `);
    const titles = nodes.filter((node) => node.htmlId === "title");
    expect(titles).toHaveLength(2);
    expect(titles.every((node) => node.id.startsWith("list:item:"))).toBe(true);
  });
});
