/**
 * The structure lock on routes whose sections come from their loader
 * (theme-route-sections.ts, `structureLocked`).
 *
 * Structure edits from the editor (reorder, remove, add, bind, swap) write
 * `{...content("x")}` call sites. A section instance whose props are spread
 * from the route's loader data is the author's data flow, which those edits
 * must not rewrite (§5.1). The lock has to follow from the same proof B1 uses
 * for that instance; it used to follow a name-based check that recorded no
 * slot when a slot element carried any other attribute, which left these
 * routes open to every structure edit.
 *
 * This is a safe refusal, not structure editing on loader routes: Design
 * still cannot add, move, remove, bind or swap these sections.
 */
import { describe, expect, it } from "vitest";
import { analyzeB1Route } from "@/lib/storefront/ast/theme-content-provenance";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  addThemeRouteSection,
  bindThemeRouteSection,
  deriveThemeRouteSections,
  listThemeRouteSectionOptions,
  removeThemeRouteSection,
  reorderThemeRouteSections,
  replaceThemeRouteSectionComponent,
} from "./theme-route-sections";

const ROUTE = "src/routes/index.tsx";
const HERO = "src/components/sections/Hero.tsx";
const PROMO = "src/components/sections/Promo.tsx";
const BANNER = "src/components/sections/Banner.tsx";
const HERO_COPY = "src/components/page-sections/index/hero/index.tsx";
const LOCKED = /reads its content through its route loader/;

const fieldsComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function ${name}({ title = "Default title", subtitle = "Default subtitle", className }: any) {
  return (
    <section className={className}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}`;

const IMPORTS = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { content, morph } from "../morph/content";
import Hero from "../components/sections/Hero";
import Promo from "../components/sections/Promo";
import Banner from "../components/sections/Banner";
`;

/** A route whose loader returns this page's content, as B1 proves it. */
const loaderRoute = (body: string) => `${IMPORTS}
const getHome = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
${body}
}`;

/** A route with no loader at all. */
const plainRoute = (body: string) => `${IMPORTS}
export const Route = createFileRoute("/")({ component: Home });

function Home() {
${body}
}`;

/** A route with a loader that returns something other than the page. */
const unrelatedLoaderRoute = (body: string) => `${IMPORTS}
export const Route = createFileRoute("/")({
  loader: () => ({ year: 2026 }),
  component: Home,
});

function Home() {
${body}
}`;

const themeFiles = (route: string) => [
  ...livePreviewPlatformFiles(),
  { path: HERO, content: fieldsComponent("Hero") },
  { path: PROMO, content: fieldsComponent("Promo") },
  { path: BANNER, content: fieldsComponent("Banner") },
  { path: HERO_COPY, content: fieldsComponent("HeroCopy") },
  { path: ROUTE, content: route },
];

const body = (pattern: string, main: string) =>
  `  const ${pattern} = Route.useLoaderData();\n  return (\n    <main>\n${main}\n      <Banner />\n    </main>\n  );`;

/** Every structure edit the editor offers, on one route. */
function structureEdits(route: string) {
  const files = themeFiles(route);
  const derived = deriveThemeRouteSections(files, ROUTE);
  const ids = derived.sections.map((section) => section.slotId);
  const option = listThemeRouteSectionOptions(files).find(
    (candidate) => candidate.componentSourcePath === BANNER,
  )!;
  const banner = derived.unboundSections.find(
    (candidate) => candidate.componentName === "Banner",
  );
  const hero = derived.sections.find((section) => section.slotId === "hero");
  return {
    ids,
    reorder: reorderThemeRouteSections(route, files, ROUTE, [...ids].reverse()),
    remove: removeThemeRouteSection(route, files, ROUTE, ids[ids.length - 1]!),
    add: addThemeRouteSection({
      source: route,
      files,
      routeSourcePath: ROUTE,
      option,
      slotId: "extra",
    }),
    bind: banner
      ? bindThemeRouteSection({
          source: route,
          files,
          routeSourcePath: ROUTE,
          candidate: banner,
          slotId: "banner",
        })
      : null,
    swap: hero
      ? replaceThemeRouteSectionComponent({
          source: route,
          files,
          routeSourcePath: ROUTE,
          slotId: "hero",
          componentSourcePath: hero.componentSourcePath,
          nextComponentSourcePath: HERO_COPY,
        })
      : null,
  };
}

const OPERATIONS = ["reorder", "remove", "add", "bind", "swap"] as const;

/**
 * The 13 loader shapes of the 2026-10-28 check. All of them spread a section
 * from the loader at its call site, so all of them are locked. The first nine
 * were locked before; A2, B2, B4 and B5 were not.
 */
const LOADER_SHAPES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "A0",
    "destructured, plain",
    body(
      "{ hero, promo }",
      `      <Hero {...hero} />\n      <Promo {...promo} />`,
    ),
  ],
  [
    "A1",
    "destructured, key only",
    body(
      "{ hero, promo }",
      `      <Hero key="h" {...hero} />\n      <Promo key="p" {...promo} />`,
    ),
  ],
  [
    "A2",
    "destructured, className on both",
    body(
      "{ hero, promo }",
      `      <Hero {...hero} className="p-4" />\n      <Promo {...promo} className="p-4" />`,
    ),
  ],
  [
    "A3",
    "destructured, a declared field on both",
    body(
      "{ hero, promo }",
      `      <Hero {...hero} title="Code title" />\n      <Promo {...promo} title="Code title" />`,
    ),
  ],
  [
    "A4",
    "destructured, one plain and one with className",
    body(
      "{ hero, promo }",
      `      <Hero {...hero} />\n      <Promo {...promo} className="p-4" />`,
    ),
  ],
  [
    "A5",
    "destructured, another read of hero",
    body(
      "{ hero, promo }",
      `      <Hero {...hero} />\n      <Promo {...promo} />\n      {hero.title ? null : null}`,
    ),
  ],
  [
    "B0",
    "page object, plain",
    body(
      "page",
      `      <Hero {...page.hero} />\n      <Promo {...page.promo} />`,
    ),
  ],
  [
    "B1",
    "page object, key only",
    body(
      "page",
      `      <Hero key="h" {...page.hero} />\n      <Promo key="p" {...page.promo} />`,
    ),
  ],
  [
    "B2",
    "page object, className on both",
    body(
      "page",
      `      <Hero {...page.hero} className="p-4" />\n      <Promo {...page.promo} className="p-4" />`,
    ),
  ],
  [
    "B3",
    "page object, a declared field on both",
    body(
      "page",
      `      <Hero {...page.hero} title="Code title" />\n      <Promo {...page.promo} title="Code title" />`,
    ),
  ],
  [
    "B4",
    "page object, one plain and one with className",
    body(
      "page",
      `      <Hero {...page.hero} />\n      <Promo {...page.promo} className="p-4" />`,
    ),
  ],
  [
    "B5",
    "page object, another use of the page",
    body(
      "page",
      `      <Hero {...page.hero} />\n      <Promo {...page.promo} />\n      <p>{String(page.title)}</p>`,
    ),
  ],
  [
    "B6",
    "page object, one plain and one with a declared field",
    body(
      "page",
      `      <Hero {...page.hero} />\n      <Promo {...page.promo} title="Code title" />`,
    ),
  ],
];

describe("routes whose sections are spread from the loader", () => {
  for (const [id, label, shape] of LOADER_SHAPES) {
    describe(`${id}: ${label}`, () => {
      const route = loaderRoute(shape);
      const edits = structureEdits(route);

      it("still lists both loader sections", () => {
        expect(edits.ids).toEqual(["hero", "promo"]);
      });

      for (const operation of OPERATIONS) {
        it(`refuses ${operation} and leaves the route as written`, () => {
          const result = edits[operation];
          expect(result).not.toBeNull();
          expect(result!.changed).toBe(false);
          expect(result!.diagnostic).toMatch(LOCKED);
          expect(result!.code ?? route).toBe(route);
        });
      }
    });
  }

  it("keeps the loader sections' fields editable: B1 still proves each field to its own loader slot", () => {
    for (const id of ["A2", "B2", "B4", "B5"]) {
      const shape = LOADER_SHAPES.find(([key]) => key === id)![2];
      const analysis = analyzeB1Route(themeFiles(loaderRoute(shape)), ROUTE);
      expect(analysis.loaderOrigin, id).toBe(true);
      const sections = analysis.instances.map((instance) => [
        instance.componentName,
        instance.section,
      ]);
      expect(sections, id).toEqual([
        ["Hero", "hero"],
        ["Promo", "promo"],
        ["Banner", null],
      ]);
      const hero = analysis.instances.find((i) => i.componentName === "Hero")!;
      expect(hero.props.title, id).toMatchObject({
        root: "loader",
        slot: "hero",
        field: "title",
      });
    }
  });
});

describe("routes whose sections do not come from the loader", () => {
  const contentSections = `  return (
    <main>
      <Hero {...content("hero")} />
      <Promo {...content("promo")} />
      <Banner />
    </main>
  );`;

  const cases: ReadonlyArray<readonly [string, string]> = [
    ["no loader", plainRoute(contentSections)],
    [
      "a loader that returns something else",
      unrelatedLoaderRoute(contentSections),
    ],
    [
      "a loader that returns the page, read nowhere in the markup",
      loaderRoute(`  return (
    <main>
      <Hero {...content("hero")} title="Code title" />
      <Promo {...content("promo")} />
      <Banner />
    </main>
  );`),
    ],
  ];

  for (const [label, route] of cases) {
    describe(label, () => {
      const edits = structureEdits(route);

      it("lists its content() sections", () => {
        expect(edits.ids).toEqual(["hero", "promo"]);
      });

      for (const operation of OPERATIONS) {
        it(`still allows ${operation}`, () => {
          const result = edits[operation];
          expect(result).not.toBeNull();
          expect(result!.diagnostic).toBeUndefined();
          expect(result!.changed).toBe(true);
          expect(result!.code).not.toBe(route);
        });
      }
    });
  }
});
