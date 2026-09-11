// @vitest-environment node
/**
 * Reordering sections that carry a visibility guard.
 *
 * The editor writes visibility as a guard around the section —
 * `{!isSectionHidden("id") && <Hero />}` — and the starter ships that shape, so
 * out of the box no section on the home page is a bare child of its `<main>`.
 * The reorder checked that sections were direct siblings and refused, which
 * means drag-to-reorder was broken for every new store and reported only as a
 * failed save.
 */
import { describe, expect, it } from "vitest";
import { reorderThemeRouteSections } from "./theme-route-sections";

const GUARDED_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
import Newsletter from "../components/Newsletter";
import Principles from "../components/Principles";

export const Route = createFileRoute("/")({ component: HomeRoute });

function HomeRoute() {
  return (
    <main>
      {!isSectionHidden("a") && <Hero {...content("a")} />}
      {!isSectionHidden("b") && (
        <Principles {...content("b")} />
      )}
      {!isSectionHidden("c") && <Newsletter {...content("c")} />}
    </main>
  );
}`;

const files = [
  { path: "src/routes/index.tsx", content: GUARDED_ROUTE },
  {
    path: "morph.theme.json",
    content: JSON.stringify({
      components: {
        "hero.default": { source: "src/components/Hero.tsx" },
        "principles.default": { source: "src/components/Principles.tsx" },
        "newsletter.default": { source: "src/components/Newsletter.tsx" },
      },
    }),
  },
  {
    path: "src/components/Hero.tsx",
    content: "export default function Hero() { return <section />; }",
  },
  {
    path: "src/components/Principles.tsx",
    content: "export default function Principles() { return <section />; }",
  },
  {
    path: "src/components/Newsletter.tsx",
    content: "export default function Newsletter() { return <section />; }",
  },
] as never;

const slotOrder = (code: string) =>
  [...code.matchAll(/content\("([^"]+)"\)/g)].map((match) => match[1]);

describe("reordering guarded sections", () => {
  it("moves them", () => {
    const result = reorderThemeRouteSections(
      GUARDED_ROUTE,
      files,
      "src/routes/index.tsx",
      ["b", "a", "c"],
    );

    expect(result.diagnostic).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(slotOrder(result.code)).toEqual(["b", "a", "c"]);
  });

  it("carries each guard with its own section", () => {
    // Moving the elements alone would leave every guard where it was, so each
    // section would inherit the visibility of whichever one took its place.
    const result = reorderThemeRouteSections(
      GUARDED_ROUTE,
      files,
      "src/routes/index.tsx",
      ["c", "b", "a"],
    );

    expect(result.code).toContain(
      '{!isSectionHidden("c") && <Newsletter {...content("c")} />}',
    );
    expect(result.code).toContain(
      '{!isSectionHidden("a") && <Hero {...content("a")} />}',
    );
    // The guard order follows the sections, not the original positions.
    expect(
      [...result.code.matchAll(/isSectionHidden\("([^"]+)"\)/g)].map(
        (m) => m[1],
      ),
    ).toEqual(["c", "b", "a"]);
  });

  it("still refuses sections that are not siblings of each other", () => {
    const nested = GUARDED_ROUTE.replace(
      '{!isSectionHidden("c") && <Newsletter {...content("c")} />}',
      '<div>{!isSectionHidden("c") && <Newsletter {...content("c")} />}</div>',
    );

    const result = reorderThemeRouteSections(
      nested,
      files,
      "src/routes/index.tsx",
      ["b", "a", "c"],
    );

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toContain("direct JSX siblings");
  });
});
