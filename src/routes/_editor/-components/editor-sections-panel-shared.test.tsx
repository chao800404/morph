// @vitest-environment node
/**
 * Which sections a page may reorder.
 *
 * Header and Footer live in the layout document, and the editor merges them
 * into the page's section list so the tree can show them. They are not the
 * page's to order: reordering rewrites the route file, and the route declares
 * only its own slots. While they sat in the sortable list, dragging the first
 * row sent the route a slot id it had never heard of, the write was refused,
 * and the editor showed "Save failed" — which read as a flaky drag.
 */
import { describe, expect, it } from "vitest";
import { reorderThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";

const ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
import Newsletter from "../components/Newsletter";

export const Route = createFileRoute("/")({ component: HomeRoute });

function HomeRoute() {
  return (
    <main>
      {!isSectionHidden("page-a") && <Hero {...content("page-a")} />}
      {!isSectionHidden("page-b") && <Newsletter {...content("page-b")} />}
    </main>
  );
}`;

const files = [
  { path: "src/routes/index.tsx", content: ROUTE },
  {
    path: "morph.theme.json",
    content: JSON.stringify({
      components: {
        "hero.default": { source: "src/components/Hero.tsx" },
        "newsletter.default": { source: "src/components/Newsletter.tsx" },
      },
    }),
  },
  {
    path: "src/components/Hero.tsx",
    content: "export default function Hero() { return <section />; }",
  },
  {
    path: "src/components/Newsletter.tsx",
    content: "export default function Newsletter() { return <section />; }",
  },
] as never;

describe("reordering a page whose tree also shows the shell", () => {
  it("succeeds for the page's own sections", () => {
    const result = reorderThemeRouteSections(
      ROUTE,
      files,
      "src/routes/index.tsx",
      ["page-b", "page-a"],
    );

    expect(result.diagnostic).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it("is refused when a layout slot is included", () => {
    // The shape the panel used to send. Kept as a test because the refusal is
    // correct — the route cannot express the layout's order — and the fix is
    // to never ask, which is what excluding the shell from the sortable list
    // now guarantees.
    const result = reorderThemeRouteSections(
      ROUTE,
      files,
      "src/routes/index.tsx",
      ["starter-header", "page-a", "page-b"],
    );

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toContain("no longer matches");
  });
});
