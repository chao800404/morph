import { describe, expect, it } from "vitest";
import { splitPageRoots } from "./page-structure";
import type { PreviewEditableNode } from "./preview-protocol";

const node = (sectionId: string): PreviewEditableNode =>
  ({
    id: `${sectionId}:node`,
    parentId: null,
    sectionId,
    label: sectionId,
    kind: "text",
    tagName: "p",
    target: { sectionId, nodeId: "node", isSection: false },
  }) as unknown as PreviewEditableNode;

/** Header, the route's own sections, then Footer — as the page paints. */
const homeNodes = [
  node("src/components/Header.tsx"),
  node("hero"),
  node("hero"),
  node("testimonial"),
  node("src/components/Footer.tsx"),
];

const templateSectionIds = new Set(["hero", "testimonial"]);
const routeSourcePath = "src/routes/index.tsx";

describe("splitPageRoots", () => {
  it("splits the layout around the template's sections", () => {
    const { before, after } = splitPageRoots({
      editableNodes: homeNodes,
      templateSectionIds,
      routeSourcePath,
    });

    expect(before).toEqual(["src/components/Header.tsx"]);
    expect(after).toEqual(["src/components/Footer.tsx"]);
  });

  it("keeps first-appearance order rather than sorting", () => {
    const { before } = splitPageRoots({
      editableNodes: [
        node("src/components/Zebra.tsx"),
        node("src/components/Alpha.tsx"),
      ],
      templateSectionIds: new Set(),
      routeSourcePath,
    });

    expect(before).toEqual([
      "src/components/Zebra.tsx",
      "src/components/Alpha.tsx",
    ]);
  });

  // An edit to the header is an edit to every page, and the panels look the
  // same either way; this is what lets them say so.
  it("marks layout modules as shared and the route's own module as not", () => {
    const { shared } = splitPageRoots({
      editableNodes: [...homeNodes, node(routeSourcePath)],
      templateSectionIds,
      routeSourcePath,
    });

    expect(shared.has("src/components/Header.tsx")).toBe(true);
    expect(shared.has("src/components/Footer.tsx")).toBe(true);
    expect(shared.has(routeSourcePath)).toBe(false);
  });

  it("treats every root as shared when the route module is unknown", () => {
    const { shared } = splitPageRoots({
      editableNodes: homeNodes,
      templateSectionIds,
    });

    expect([...shared]).toEqual([
      "src/components/Header.tsx",
      "src/components/Footer.tsx",
    ]);
  });

  it("never repeats a root, however many nodes it owns", () => {
    const { before } = splitPageRoots({
      editableNodes: [
        node("src/components/Header.tsx"),
        node("src/components/Header.tsx"),
      ],
      templateSectionIds,
      routeSourcePath,
    });

    expect(before).toEqual(["src/components/Header.tsx"]);
  });
});
