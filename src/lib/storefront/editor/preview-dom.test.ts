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
  it("uses an authored HTML id and otherwise falls back to the tag name", () => {
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

    expect(copy?.label).toBe("hero-copy");
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
