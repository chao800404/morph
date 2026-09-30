// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getComponentFilePath` on a Theme without a manifest reads every route's
 * sections, which parses every route. It is asked for from render, so the
 * parse is cached per file list; these pin that it is reused, and that it is
 * never reused for inputs it did not read.
 *
 * Parses are counted on the real `deriveThemeRouteSections`, wrapped.
 */
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("../compiler/theme-route-sections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../compiler/theme-route-sections")>();
  return {
    ...actual,
    deriveThemeRouteSections: (...args: Parameters<typeof actual.deriveThemeRouteSections>) => {
      parses.count += 1;
      return actual.deriveThemeRouteSections(...args);
    },
  };
});

import { getComponentFilePath } from "./theme-ast-transformer";

type File = { path: string; content?: string };

const routeUsing = (component: string) => `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import ${component} from "../blocks/${component}";

export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><${component} {...content("hero-slot")} /></main>;
}`;

function theme(component = "Hero"): File[] {
  return [
    { path: "src/routes/index.tsx", content: routeUsing(component) },
    { path: "src/morph/content.ts", content: "export function content() {}" },
    { path: `src/blocks/${component}.tsx`, content: `export default function ${component}() {}` },
  ];
}

beforeEach(() => {
  parses.count = 0;
});

describe("the route sections behind getComponentFilePath", () => {
  it("parses a file list once, however often it is asked", () => {
    const files = theme();
    expect(getComponentFilePath("hero", files)).toBe("src/blocks/Hero.tsx");
    const afterFirst = parses.count;
    expect(afterFirst).toBeGreaterThan(0);
    expect(getComponentFilePath("hero", files)).toBe("src/blocks/Hero.tsx");
    expect(getComponentFilePath("promo", files)).toBeNull();
    expect(parses.count).toBe(afterFirst);
  });

  it("keeps two lists in use at once apart, each parsed once", () => {
    const editor = theme("Hero");
    const preview = theme("Banner");
    for (let round = 0; round < 3; round += 1) {
      expect(getComponentFilePath("hero", editor)).toBe("src/blocks/Hero.tsx");
      expect(getComponentFilePath("banner", preview)).toBe("src/blocks/Banner.tsx");
    }
    // One parse of the single route per list; alternating did not evict either.
    expect(parses.count).toBe(2);
  });

  it("parses again when a file in the same list is edited in place", () => {
    const files = theme("Hero");
    expect(getComponentFilePath("hero", files)).toBe("src/blocks/Hero.tsx");
    const before = parses.count;
    // Same list object, same file object: the route now uses another component.
    files[0]!.content = routeUsing("Banner");
    files.push({ path: "src/blocks/Banner.tsx", content: "export default function Banner() {}" });
    expect(getComponentFilePath("banner", files)).toBe("src/blocks/Banner.tsx");
    expect(getComponentFilePath("hero", files)).toBeNull();
    expect(parses.count).toBeGreaterThan(before);
  });

  it("follows files added, removed and renamed", () => {
    const files = theme("Hero");
    expect(getComponentFilePath("hero", files)).toBe("src/blocks/Hero.tsx");

    // Removed: the component file is gone from the list.
    const removed = files.splice(2, 1);
    expect(getComponentFilePath("hero", files)).toBeNull();

    // Added back.
    files.push(removed[0]!);
    expect(getComponentFilePath("hero", files)).toBe("src/blocks/Hero.tsx");

    // Renamed: the route and the component both move to a new name.
    files[0]!.content = routeUsing("HeroBanner");
    files[2] = { path: "src/blocks/HeroBanner.tsx", content: "export default function HeroBanner() {}" };
    expect(getComponentFilePath("hero", files)).toBeNull();
    expect(getComponentFilePath("hero-banner", files)).toBe("src/blocks/HeroBanner.tsx");
  });
});
