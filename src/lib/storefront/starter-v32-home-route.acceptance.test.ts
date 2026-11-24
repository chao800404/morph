import { describe, expect, it } from "vitest";
import { classifyHideCapability } from "./ast/theme-hide-capability";
import {
  deriveThemeRouteSections,
  themeRouteStructureLock,
} from "./compiler/theme-route-sections";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import { sourceRequiresStartPreview } from "./starter-upgrade-start-preview";

/**
 * RED by design (2026-11-24): the acceptance gate for the Starter 32 home
 * route the user decided on, run against today's editor analysis.
 *
 * Decision: the home route reads its page through the hosted SDK on the
 * server: the route loader calls a thin createServerFn that returns
 * `morph.pages.get("/")` from `@morph/sdk/start`; the root layout keeps its
 * same-origin read for the shared header and footer only.
 *
 * Starter 31's home keeps every Design capability: its sections are bound,
 * Add/move/remove works, and each section can be hidden (its own
 * `!isSectionHidden(...)` guard). Starter 32 must not take any of that away
 * from a new Theme. Read from the code, three of these fail today, each for
 * a reason that is a decision, not a Starter bug:
 *
 * - bound sections: Start's B1 trusts `morph` only from `src/morph/content.ts`
 *   (`START_B1_PROFILE`, `contentModuleMorph`); `@morph/sdk/start` is
 *   deliberately not trusted yet (theme-hide-capability.test.ts H8).
 * - structure editing: a route whose sections are spread from its loader is
 *   structure-locked (`LOADER_STRUCTURE_LOCKED`, #312).
 * - hide: M3 v1 supports loader call sites only as per-field member reads;
 *   a spread `{...page[slot]}` is outside v1 (D104/D107), so a hidden home
 *   section would render its component's defaults.
 *
 * The candidate source below is what Starter 32 would ship once adopted
 * (page-owned section copies), so the gate runs on the real workspace.
 * Nothing in the product reads it.
 */

const HOME = "src/routes/index.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";

const HOME_SLOTS = [
  "starter-hero",
  "starter-introduction",
  "starter-categories",
  "starter-story",
  "starter-principles",
  "starter-newsletter",
] as const;

const V32_CANDIDATE_HOME_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "@morph/sdk/start";
import CategoryShowcase from "../components/page-sections/index/starter-categories/index";
import EditorialIntro from "../components/page-sections/index/starter-introduction/index";
import Hero from "../components/page-sections/index/starter-hero/index";
import ImageWithText from "../components/page-sections/index/starter-story/index";
import Newsletter from "../components/page-sections/index/starter-newsletter/index";
import Principles from "../components/page-sections/index/starter-principles/index";

// Read on the server: a loader also runs in the browser on in-site
// navigation, and the SDK refuses a browser read, so the loader calls this
// server function instead of the SDK. This route alone decides the page's
// sections; the root layout reads only the shared header and footer.
const getHomePage = createServerFn({ method: "GET" }).handler(() =>
  morph.pages.get("/"),
);

export const Route = createFileRoute("/")({
  loader: () => getHomePage(),
  component: HomeRoute,
});

function HomeRoute() {
  const page = Route.useLoaderData();
  return (
    <main>
      <Hero {...page["starter-hero"]} />
      <EditorialIntro {...page["starter-introduction"]} />
      <CategoryShowcase {...page["starter-categories"]} />
      <ImageWithText {...page["starter-story"]} />
      <Principles {...page["starter-principles"]} />
      <Newsletter {...page["starter-newsletter"]} />
    </main>
  );
}
`;

function v32Workspace() {
  return starterThemeWorkspaceFiles().map((file) => ({
    path: file.path,
    content: file.path === HOME ? V32_CANDIDATE_HOME_ROUTE : file.content,
  }));
}

describe("the Starter 32 candidate home route", () => {
  it("needs the full Start preview, so a Theme created from it records start", () => {
    expect(sourceRequiresStartPreview(HOME, V32_CANDIDATE_HOME_ROUTE)).toBe(
      true,
    );
  });

  it("takes its page content from one place: its own loader", () => {
    const files = v32Workspace();
    const home = files.find((file) => file.path === HOME)!.content;
    // No read of the root's content context for the page's sections.
    expect(home).not.toMatch(/from "\.\.\/morph\/content"/);
    expect(home.match(/Route\.useLoaderData\(\)/g)).toHaveLength(1);
    expect(home.match(/morph\.pages\.get\(/g)).toHaveLength(1);
    // The layout the root renders reads only the shared header and footer.
    const layout = files.find((file) => file.path === LAYOUT)!.content;
    const layoutSlots = [...layout.matchAll(/content\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(layoutSlots.sort()).toEqual(["starter-footer", "starter-header"]);
    for (const slot of HOME_SLOTS) expect(layout).not.toContain(slot);
  });

  // RED today: @morph/sdk/start is not a trusted morph for Start's B1.
  it("keeps every home section bound for Design", () => {
    const derived = deriveThemeRouteSections(v32Workspace(), HOME);
    expect(derived.diagnostics).toEqual([]);
    expect(derived.sections.map((section) => section.slotId).sort()).toEqual(
      [...HOME_SLOTS].sort(),
    );
  });

  // RED today: a loader-spread route is structure-locked (#312).
  it("keeps Add, move and remove section in Design", () => {
    expect(themeRouteStructureLock(v32Workspace(), HOME)).toBeNull();
  });

  // RED today: loader spreads are outside M3 Hide v1.
  it.each(HOME_SLOTS)("keeps %s hideable", (slot) => {
    expect(
      classifyHideCapability({
        files: v32Workspace(),
        callSitePath: HOME,
        slot,
        scope: "route",
      }),
    ).toMatchObject({ kind: "supported" });
  });
});
