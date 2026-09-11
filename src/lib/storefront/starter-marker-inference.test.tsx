// @vitest-environment node
/**
 * Which identity markers a component has to write by hand: none.
 *
 * The interpreter runs a component's `map()` itself, so it knows which row it
 * is on and derives `items.2.title` unasked. The rule against hand-written
 * `data-*` rests on that being true of every binding a starter uses, which is
 * worth an assertion rather than a memory — the last exception was a grouped
 * image read through a fallback chain, and it only survived because the
 * inference stopped at optional chaining.
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

  it("derives a grouped value read through a fallback chain", () => {
    // `item.image?.src ?? item.imageSrc ?? "…"`. The field is `image`: the
    // first step off the row, with the rest reaching inside the value it
    // holds and the fallbacks describing what to show when it is empty.
    expect(pathsFor("src/components/CategoryShowcase.tsx")).toContain(
      "items.0.image",
    );
  });

  it("writes no identity markers at all", () => {
    for (const file of files) {
      if (!file.path.startsWith("src/components/")) continue;
      expect(
        file.content,
        `${file.path} writes an identity marker the inference can produce`,
      ).not.toContain("data-storefront-field-path");
    }
  });
});
