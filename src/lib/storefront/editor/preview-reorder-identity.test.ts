// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import {
  isCompatibleReorderTarget,
  reorderCommitFor,
  reorderIdentity,
  type ReorderGestureIdentity,
} from "./preview-reorder-identity";

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not, and the
  // selector it builds is what makes a source position unambiguous.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const mount = (html: string) => {
  document.body.innerHTML = html;
  return (selector: string) =>
    document.body.querySelector<HTMLElement>(selector)!;
};

const SECTION = (inner: string) =>
  `<div data-storefront-section-id="hero" data-morph-source-file="src/components/Hero.tsx">${inner}</div>`;

describe("what a dragged element is", () => {
  it("calls a section root a section, because it moves in the route's list", () => {
    const q = mount(SECTION("<p>x</p>"));
    const identity = reorderIdentity(q("[data-storefront-section-id]"));
    expect(identity?.kind).toBe("section");
    expect(identity?.sectionId).toBe("hero");
  });

  it("calls a row of an array field an array item", () => {
    // The row itself, whose path ends at the index. A field inside it —
    // `items.2.title` — names a value, not something that can be reordered.
    const q = mount(SECTION(`<p data-storefront-field-path="items.2">x</p>`));
    const identity = reorderIdentity(q("[data-storefront-field-path]"));
    expect(identity?.kind).toBe("array");
    expect(identity?.arrayPath).toBe("items");
    expect(identity?.fieldPath).toBe("items.2");
  });

  it("treats a field inside a row as source, not as a movable row", () => {
    const q = mount(
      SECTION(
        `<p data-storefront-field-path="items.2.title" data-morph-loc="src/components/Hero.tsx:8:5">x</p>`,
      ),
    );
    expect(reorderIdentity(q("[data-storefront-field-path]"))?.kind).toBe(
      "source",
    );
  });

  it("falls back to a source position, but only when it names one element", () => {
    // An element inside map() renders once per item and shares one position,
    // which is exactly the ambiguity that must not be reordered through source.
    const q = mount(
      SECTION(`<p data-morph-loc="src/components/Hero.tsx:4:3">a</p>`),
    );
    expect(reorderIdentity(q("[data-morph-loc]"))?.kind).toBe("source");

    const dup = mount(
      SECTION(
        `<p data-morph-loc="src/components/Hero.tsx:4:3">a</p>` +
          `<p data-morph-loc="src/components/Hero.tsx:4:3">b</p>`,
      ),
    );
    expect(reorderIdentity(dup("[data-morph-loc]"))).toBeNull();
  });

  it("refuses an element with no section or source file to write back to", () => {
    const q = mount(`<p data-morph-node="x">orphan</p>`);
    expect(reorderIdentity(q("[data-morph-node]"))).toBeNull();
  });
});

describe("where it may be dropped", () => {
  const parent = () => document.createElement("div");

  const gesture = (
    over: Partial<ReorderGestureIdentity> & { parent: HTMLElement },
  ): ReorderGestureIdentity => ({
    kind: "array",
    sectionId: "hero",
    sourceFilePath: "src/components/Hero.tsx",
    arrayPath: "items",
    ...over,
  });

  const identity = (
    over: Partial<Parameters<typeof isCompatibleReorderTarget>[0]> & {
      parent: HTMLElement;
    },
  ) => ({
    kind: "array" as const,
    nodeId: null,
    fieldPath: "items.1.title",
    arrayPath: "items",
    sectionId: "hero",
    sourceFilePath: "src/components/Hero.tsx",
    ...over,
  });

  it("accepts a sibling of the same kind in the same list", () => {
    const shared = parent();
    expect(
      isCompatibleReorderTarget(
        identity({ parent: shared }),
        gesture({ parent: shared }),
      ),
    ).toBe(true);
  });

  it("refuses a different parent, however alike the two look", () => {
    expect(
      isCompatibleReorderTarget(
        identity({ parent: parent() }),
        gesture({ parent: parent() }),
      ),
    ).toBe(false);
  });

  it("refuses another array's rows", () => {
    const shared = parent();
    expect(
      isCompatibleReorderTarget(
        identity({ parent: shared, arrayPath: "features" }),
        gesture({ parent: shared }),
      ),
    ).toBe(false);
  });

  it("requires two sections to be different ones, and everything else to share one", () => {
    const shared = parent();
    expect(
      isCompatibleReorderTarget(
        identity({ parent: shared, kind: "section", sectionId: "footer" }),
        gesture({ parent: shared, kind: "section" }),
      ),
    ).toBe(true);
    expect(
      isCompatibleReorderTarget(
        identity({ parent: shared, kind: "section", sectionId: "hero" }),
        gesture({ parent: shared, kind: "section" }),
      ),
    ).toBe(false);
    expect(
      isCompatibleReorderTarget(
        identity({ parent: shared, sectionId: "footer" }),
        gesture({ parent: shared }),
      ),
    ).toBe(false);
  });
});

describe("the edit a drop means", () => {
  const shared = () => document.createElement("div");

  it("moves an array item within its field", () => {
    const parent = shared();
    expect(
      reorderCommitFor(
        {
          kind: "array",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
          arrayPath: "items",
          draggedFieldPath: "items.0.title",
          draggedNodeId: null,
        },
        {
          kind: "array",
          nodeId: null,
          fieldPath: "items.2.title",
          arrayPath: "items",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
        },
      ),
    ).toEqual({
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: "hero",
      draggedFieldPath: "items.0.title",
      targetFieldPath: "items.2.title",
    });
  });

  it("moves a section in the route's list", () => {
    const parent = shared();
    expect(
      reorderCommitFor(
        {
          kind: "section",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/routes/index.tsx",
          arrayPath: null,
          draggedFieldPath: null,
          draggedNodeId: null,
        },
        {
          kind: "section",
          nodeId: "footer",
          fieldPath: null,
          arrayPath: null,
          parent,
          sectionId: "footer",
          sourceFilePath: "src/routes/index.tsx",
        },
      ),
    ).toEqual({
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: "hero",
      targetSectionId: "footer",
    });
  });

  it("moves anything else among its JSX siblings", () => {
    const parent = shared();
    expect(
      reorderCommitFor(
        {
          kind: "source",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
          arrayPath: null,
          draggedFieldPath: null,
          draggedNodeId: "4:3",
        },
        {
          kind: "source",
          nodeId: "9:5",
          fieldPath: null,
          arrayPath: null,
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
        },
      ),
    ).toMatchObject({
      type: "morph:storefront-preview-commit-sibling-reorder",
      draggedNodeId: "4:3",
      targetNodeId: "9:5",
    });
  });

  it("says nothing when the drop does not add up", () => {
    // Better no edit than a guessed one: the author would watch something
    // move somewhere they never asked for.
    const parent = shared();
    expect(
      reorderCommitFor(
        {
          kind: "array",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
          arrayPath: "items",
          draggedFieldPath: null,
          draggedNodeId: null,
        },
        {
          kind: "array",
          nodeId: null,
          fieldPath: null,
          arrayPath: "items",
          parent,
          sectionId: "hero",
          sourceFilePath: "src/components/Hero.tsx",
        },
      ),
    ).toBeNull();
  });
});
