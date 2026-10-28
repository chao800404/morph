/**
 * The structure lock on a route can change while the route file does not.
 *
 * The route reads its loader through a server function in another module.
 * While that function returns a plain object, B1 cannot root the route's
 * `useLoaderData()` in this page, so the `<Promo {...page.promo} />` instance
 * is not a loader section and the two `content()` sections can be reordered.
 * Once another tab changes only that module to return `morph.pages.get("/")`,
 * the same route text is a loader route and the same reorder must be refused.
 *
 * This is the fixture for case 2B of the conflict reproduction
 * (`handoff/2026-10-28/conflict-refusal-repro-plan.md`): a Design structure
 * edit computed against an older Theme, where the newest Theme refuses it.
 * It proves the newest Theme's B1 and lock results differ; whether a Design
 * retry is checked again on the newest Theme is the E2E's question.
 */
import { describe, expect, it } from "vitest";
import { analyzeB1Route } from "@/lib/storefront/ast/theme-content-provenance";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  deriveThemeRouteSections,
  reorderThemeRouteSections,
  themeRouteStructureLock,
} from "./theme-route-sections";

const ROUTE = "src/routes/index.tsx";
const DATA = "src/server/home.ts";
const LOCKED = /reads its content through its route loader/;

const fields = (name: string) => `export const contentFields = {
  title: { type: "text", label: "Title" },
};
export default function ${name}({ title = "Default title" }: any) {
  return <section><h1>{title}</h1></section>;
}`;

/** The route. The same text before and after. */
const DEPENDENCY_LOCK_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/sections/Hero";
import Banner from "../components/sections/Banner";
import Promo from "../components/sections/Promo";
import { getHome } from "../server/home";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const page = Route.useLoaderData();
  return (
    <main>
      <Hero {...content("hero")} />
      <Banner {...content("banner")} />
      <Promo {...page.promo} />
    </main>
  );
}`;

const DATA_BEFORE = `import { createServerFn } from "@tanstack/react-start";
export const getHome = createServerFn().handler(() => ({ promo: { title: "Static" } }));`;

const DATA_AFTER = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`;

const theme = (data: string) => [
  ...livePreviewPlatformFiles(),
  { path: "src/components/sections/Hero.tsx", content: fields("Hero") },
  { path: "src/components/sections/Banner.tsx", content: fields("Banner") },
  { path: "src/components/sections/Promo.tsx", content: fields("Promo") },
  { path: DATA, content: data },
  { path: ROUTE, content: DEPENDENCY_LOCK_ROUTE },
];

const HERO_BANNER_SWAPPED = ["banner", "hero"];

describe("the structure lock follows the loader's module, not only the route file", () => {
  it("before: the loader is not this page, and the content sections can be reordered", () => {
    const files = theme(DATA_BEFORE);
    expect(analyzeB1Route(files, ROUTE).loaderOrigin).toBe(false);
    expect(
      deriveThemeRouteSections(files, ROUTE).sections.map((s) => s.slotId),
    ).toEqual(["hero", "banner"]);
    const reordered = reorderThemeRouteSections(
      DEPENDENCY_LOCK_ROUTE,
      files,
      ROUTE,
      HERO_BANNER_SWAPPED,
    );
    expect(reordered.changed).toBe(true);
  });

  it("after only the loader's module changed: the same reorder of the same route text is refused", () => {
    const files = theme(DATA_AFTER);
    const b1 = analyzeB1Route(files, ROUTE);
    expect(b1.loaderOrigin).toBe(true);
    expect(
      b1.instances.some(
        (instance) =>
          instance.section !== null && instance.sourceRoots.includes("loader"),
      ),
    ).toBe(true);
    const reordered = reorderThemeRouteSections(
      DEPENDENCY_LOCK_ROUTE,
      files,
      ROUTE,
      HERO_BANNER_SWAPPED,
    );
    expect(reordered.changed).toBe(false);
    expect(String((reordered as { diagnostic?: unknown }).diagnostic)).toMatch(
      LOCKED,
    );
  });

  it("themeRouteStructureLock gives the same answer as the edits, for a caller holding an older rewrite", () => {
    expect(themeRouteStructureLock(theme(DATA_BEFORE), ROUTE)).toBeNull();
    expect(themeRouteStructureLock(theme(DATA_AFTER), ROUTE)).toMatch(LOCKED);
  });
});
