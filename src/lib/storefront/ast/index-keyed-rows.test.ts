import { describe, expect, it } from "vitest";
import { findIndexKeyedContentArrayMaps } from "./inject-preview-bindings";

function component(navBlock: string) {
  return `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  navItems: {
    type: "array",
    label: "Navigation",
    fields: { label: { type: "text", label: "Label", maxLength: 40 } },
  },
} as const satisfies ThemeContentFields;

export default function Header({ navItems = [] }: { navItems?: { id?: string; label?: string }[] }) {
  return (
    <nav>
${navBlock}
    </nav>
  );
}
`;
}

const path = "src/components/Header.tsx";

describe("findIndexKeyedContentArrayMaps", () => {
  it("reports a row keyed by its position", () => {
    const found = findIndexKeyedContentArrayMaps({
      path,
      content: component(
        `      {navItems.map((item, index) => (
        <span key={index}>{item.label}</span>
      ))}`,
      ),
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.arrayPath).toBe("navItems");
  });

  it("says nothing about a row keyed by its identity", () => {
    expect(
      findIndexKeyedContentArrayMaps({
        path,
        content: component(
          `      {navItems.map((item, index) => (
        <span key={item.id}>{item.label}</span>
      ))}`,
        ),
      }),
    ).toEqual([]);
  });

  /**
   * The shape the starter ships while documents without row ids are still out
   * there. Warning about the code Morph itself writes would be noise; this
   * becomes reportable once the fallback is gone.
   */
  it("stays quiet on the id-with-index fallback", () => {
    expect(
      findIndexKeyedContentArrayMaps({
        path,
        content: component(
          `      {navItems.map((item, index) => (
        <span key={item.id ?? index}>{item.label}</span>
      ))}`,
        ),
      }),
    ).toEqual([]);
  });

  it("ignores an array that is not a declared content field", () => {
    expect(
      findIndexKeyedContentArrayMaps({
        path,
        content: `export default function Header() {
  const rows = [1, 2];
  return <nav>{rows.map((item, index) => <span key={index}>{item}</span>)}</nav>;
}
`,
      }),
    ).toEqual([]);
  });

  it("reports each declared array once", () => {
    const found = findIndexKeyedContentArrayMaps({
      path,
      content: `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  navItems: {
    type: "array",
    label: "Nav",
    fields: { label: { type: "text", label: "L", maxLength: 40 } },
  },
  helpItems: {
    type: "array",
    label: "Help",
    fields: { label: { type: "text", label: "L", maxLength: 40 } },
  },
} as const satisfies ThemeContentFields;

export default function Footer({ navItems = [], helpItems = [] }: { navItems?: { label?: string }[]; helpItems?: { label?: string }[] }) {
  return (
    <nav>
      {navItems.map((item, index) => <span key={index}>{item.label}</span>)}
      {helpItems.map((item, i) => <span key={i}>{item.label}</span>)}
    </nav>
  );
}
`,
    });

    expect(found.map((entry) => entry.arrayPath).sort()).toEqual([
      "helpItems",
      "navItems",
    ]);
  });

  it("points at the key, not the map", () => {
    const content = component(
      `      {navItems.map((item, index) => (
        <span key={index}>{item.label}</span>
      ))}`,
    );
    const line = content.split("\n").findIndex((row) => row.includes("key=")) + 1;

    expect(findIndexKeyedContentArrayMaps({ path, content })[0]?.line).toBe(line);
  });
});
