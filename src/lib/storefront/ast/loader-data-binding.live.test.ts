/**
 * Case B of the content binding contract (docs/content-binding-contract-design.md
 * §5.1, §6): content read by a server function, returned by the route's loader
 * and destructured from `Route.useLoaderData()`.
 *
 *   const getHome = createServerFn().handler(() => morph.pages.get("/"));
 *   loader: () => getHome()
 *   const { hero } = Route.useLoaderData();
 *   <Hero {...hero} />
 *
 * What runs here is the product's own preview source pass and route-section
 * derivation, real React and a real router. The server function is the
 * harness's in-process stand-in (`live-preview-render.ts`): passing here is
 * not a full Start preview acceptance, and says nothing about the default
 * client-only preview, where this page cannot run at all.
 *
 * Today the editor recognises a section only at the JSX call site, as
 * `{...content("x")}` or `{...page.x}` on a same-file
 * `await morph.pages.get("…")`. So this page renders its stored values, but
 * the editor cannot tell which Document section `<Hero>` is. The two gaps
 * that follow from that are recorded as `it.fails` (each confirmed to fail on
 * the assertion it names, with the page itself rendering); the refusal cases
 * at the end hold the first version's limits.
 */
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { deriveThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";
import { prepareSourcesForLivePreview } from "@/lib/storefront/source-language/tsx-source-language";
import { isValidThemeContentSlotId } from "@/lib/storefront/theme-content-slots";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

const ROUTE = "src/routes/index.tsx";
const HERO = "src/components/Hero.tsx";

const HERO_SOURCE = `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}`;

const IMPORTS = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
`;

/** The first version's provable chain, every link passing the value on as is. */
const CASE_B_ROUTE = `${IMPORTS}
const getHome = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const { hero } = Route.useLoaderData();
  return (
    <main>
      <Hero {...hero} />
    </main>
  );
}`;

const HOME: StorefrontPageDocument = {
  version: 1,
  sections: [
    {
      id: "hero",
      type: "hero",
      enabled: true,
      props: { title: "Stored title", subtitle: "Stored subtitle" },
    },
  ],
} as StorefrontPageDocument;

const themeFiles = (route: string) => [
  ...livePreviewPlatformFiles(),
  { path: HERO, content: HERO_SOURCE },
  { path: ROUTE, content: route },
];

async function renderCaseB() {
  return renderLivePreviewRoute({
    files: themeFiles(CASE_B_ROUTE),
    documents: { index: HOME },
  });
}

/** The section ids the route lists, as the Sections panel and Document read them. */
const routeSlotIds = (route: string) =>
  deriveThemeRouteSections(themeFiles(route), ROUTE).sections.map(
    (section) => section.slotId,
  );

/** The route module as the preview serves it, after the identity pass. */
const previewedRoute = (route: string) =>
  prepareSourcesForLivePreview(themeFiles(route)).files.find(
    (file) => file.path === ROUTE,
  )?.content ?? "";

describe("case B: server function → loader → useLoaderData", () => {
  it("renders the stored values through the server function, the loader and useLoaderData", async () => {
    // The fixture works: the page runs and shows what the Document stores,
    // not Hero's defaults. Without this, a failing binding check below could
    // be a broken fixture rather than the gap it records.
    const { html, prepared } = await renderCaseB();
    expect(prepared.bindings.skipped).toEqual([]);
    expect(html).toContain("Stored title");
    expect(html).toContain("Stored subtitle");
    expect(html).not.toContain("Default title");
  });

  it("does not resolve a click to any Document section today, so nothing can be written there", async () => {
    // P4, recorded as it is. Hero's own field attributes are still injected,
    // so the click names `title`, but with no section wrapper the nearest
    // section root is Hero's own, identified by its source file. That is not
    // a slot id, so it can never name a Document section (the server looks
    // the section up in the Document and refuses an unknown one: see
    // storefront-theme.dal.test.ts).
    const { html } = await renderCaseB();
    const root = mountLivePreview(html);
    const selected = resolveSelectable(root.querySelector("h1"));
    expect(selected?.fieldKey).toBe("title");
    expect(selected?.sectionId).not.toBe("hero");
    expect(isValidThemeContentSlotId(selected?.sectionId)).toBe(false);
  });

  it.fails("lists <Hero {...hero}> as the route's `hero` section (P1)", () => {
    // Without it the route has no `hero` section for the Sections panel or
    // the Document to address.
    expect(routeSlotIds(CASE_B_ROUTE)).toContain("hero");
  });

  it.fails("wraps <Hero {...hero}> as the `hero` section in the preview, and a click resolves there (P2)", async () => {
    const { html } = await renderCaseB();
    expect(html).toContain('data-storefront-section-id="hero"');
    const root = mountLivePreview(html);
    const selected = resolveSelectable(root.querySelector("h1"));
    expect(selected?.sectionId).toBe("hero");
    expect(selected?.fieldKey).toBe("title");
  });
});

/**
 * Shapes the first version must refuse (§5.1 "拒絕條件").
 *
 * Nothing in case B is recognised yet, so these pass today without proving
 * anything. They become meaningful once P1 and P2 are implemented: then the
 * provable chain above must bind and each of these must not. The reverse
 * check belongs to that change — loosening one refusal must turn its case
 * here red.
 */
describe("case B: shapes the first version refuses", () => {
  const notBound = (route: string) => {
    expect(routeSlotIds(route)).not.toContain("hero");
    expect(previewedRoute(route)).not.toContain(
      'data-storefront-section-id="hero"',
    );
  };

  const route = (parts: {
    serverFn?: string;
    loader?: string;
    body?: string;
  }) => `${IMPORTS}
${parts.serverFn ?? 'const getHome = createServerFn().handler(() => morph.pages.get("/"));'}

export const Route = createFileRoute("/")({
  loader: ${parts.loader ?? "() => getHome()"},
  component: Home,
});

function Home() {
${parts.body ?? "  const { hero } = Route.useLoaderData();\n  return <main><Hero {...hero} /></main>;"}
}`;

  it("a path that is not a string literal", () => {
    notBound(
      route({
        serverFn: `const path = "/";
const getHome = createServerFn().handler(() => morph.pages.get(path));`,
      }),
    );
  });

  it('another page\'s content ("/home" is not the "/" route\'s page)', () => {
    notBound(
      route({
        serverFn:
          'const getHome = createServerFn().handler(() => morph.pages.get("/home"));',
      }),
    );
  });

  it("a handler that transforms what it read", () => {
    notBound(
      route({
        serverFn: `const getHome = createServerFn().handler(async () => {
  const page = await morph.pages.get("/");
  return { ...page, hero: { ...page.hero, title: "Sale" } };
});`,
      }),
    );
  });

  it("a server function with middleware", () => {
    notBound(
      route({
        serverFn:
          'const getHome = createServerFn().middleware([]).handler(() => morph.pages.get("/"));',
      }),
    );
  });

  it("a loader that wraps the result in an object", () => {
    notBound(
      route({
        loader: "async () => ({ home: await getHome() })",
        body: "  const { home } = Route.useLoaderData();\n  return <main><Hero {...home.hero} /></main>;",
      }),
    );
  });

  it("a destructuring default", () => {
    notBound(
      route({
        body: "  const { hero = {} } = Route.useLoaderData();\n  return <main><Hero {...hero} /></main>;",
      }),
    );
  });

  it("a binding that is reassigned", () => {
    notBound(
      route({
        body: `  let { hero } = Route.useLoaderData();
  hero = { ...hero, title: "Sale" };
  return <main><Hero {...hero} /></main>;`,
      }),
    );
  });

  it("a name redeclared in an inner scope", () => {
    notBound(
      route({
        body: `  const { hero } = Route.useLoaderData();
  function Inner() {
    const hero = { title: "Sale" };
    return <Hero {...hero} />;
  }
  return <main>{hero.title}<Inner /></main>;`,
      }),
    );
  });

  it("a prop written after the spread, overriding it", () => {
    notBound(
      route({
        body: '  const { hero } = Route.useLoaderData();\n  return <main><Hero {...hero} title="Sale" /></main>;',
      }),
    );
  });

  it("another spread on the same element", () => {
    notBound(
      route({
        body: `  const { hero } = Route.useLoaderData();
  const defaults = { subtitle: "Sale" };
  return <main><Hero {...defaults} {...hero} /></main>;`,
      }),
    );
  });
});
