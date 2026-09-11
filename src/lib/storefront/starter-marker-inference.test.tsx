// @vitest-environment node
/**
 * Which identity markers a component still has to write by hand.
 *
 * Almost none. The interpreter runs a component's `map()` itself, so it knows
 * which row it is on and derives `items.2.title` without being told. The rule
 * against hand-written `data-*` rests on that being true, so it is worth an
 * assertion rather than a memory.
 *
 * The exception is a binding the inference cannot follow to a single field —
 * an image whose source is a fallback chain. That marker earns its place, and
 * this test says which one it is so nobody removes it as tidying.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import { STARTER_THEME_FILES } from "./starter-theme-files";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

const rows = {
  items: [
    {
      title: "A",
      caption: "a",
      link: { href: "/a" },
      image: { src: "/a.png", alt: "a" },
    },
    {
      title: "B",
      caption: "b",
      link: { href: "/b" },
      image: { src: "/b.png", alt: "b" },
    },
  ],
};

function pathsFor(path: string, content?: string) {
  const used = content
    ? files.map((file) => (file.path === path ? { ...file, content } : file))
    : files;
  const result = renderSafeThemeComponent({
    files: used,
    sourcePath: path,
    props: rows,
  } as never) as { success: boolean; node: unknown };
  expect(result.success).toBe(true);
  const markup = renderToStaticMarkup(result.node as never);
  return [
    ...new Set(
      [...markup.matchAll(/data-storefront-field-path="([^"]*)"/g)].map(
        (m) => m[1],
      ),
    ),
  ].sort();
}

describe("row identity in the starter", () => {
  it("is derived, not authored, for the components that write nothing", () => {
    for (const file of files) {
      if (!file.path.startsWith("src/components/")) continue;
      expect(
        (file.content.match(/data-storefront-field-path/g) || []).length,
        `${file.path} writes more identity markers than it needs`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("still names every row of a repeated field", () => {
    const paths = pathsFor("src/components/CategoryShowcase.tsx");

    expect(paths).toContain("items.0.title");
    expect(paths).toContain("items.1.title");
    expect(paths).toContain("items.0.caption");
  });

  it("keeps the one marker the inference cannot replace", () => {
    // The image's source is `item.image?.src ?? item.imageSrc ?? "…"`, which
    // names no single field, so nothing can be inferred from it.
    const withMarker = pathsFor("src/components/CategoryShowcase.tsx");
    expect(withMarker).toContain("items.0.image");

    const source = files.find(
      (file) => file.path === "src/components/CategoryShowcase.tsx",
    )!.content;
    const without = pathsFor(
      "src/components/CategoryShowcase.tsx",
      source.replace(/\s*data-storefront-field-path=\{`[^`]*`\}/g, ""),
    );
    expect(without).not.toContain("items.0.image");
    // And removing it costs nothing else, which is why the other three went.
    expect(without).toContain("items.0.title");
  });
});
