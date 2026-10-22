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
 * not a full Start preview acceptance — that is `e2e/loader-data-binding.spec.ts`
 * — and says nothing about the default client-only preview, where this page
 * cannot run at all.
 *
 * The first version binds only a chain whose every link passes the value on
 * as it is (`collectLoaderSlotBindings`). Each refusal below is paired with a
 * shape that does bind, so a refusal holds because of its own rule rather
 * than because nothing binds at all.
 */
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  deriveThemeRouteSections,
  removeThemeRouteSection,
  reorderThemeRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import { SECTION_HIDDEN_ATTRIBUTE } from "@/lib/storefront/ast/inject-preview-bindings";
import {
  collectEditableDescendantFields,
  collectPreviewEditableNodes,
  PREVIEW_SECTION_HIDDEN_ATTRIBUTE,
  resolveSelectable,
} from "@/lib/storefront/editor/preview-dom";
import { prepareSourcesForLivePreview } from "@/lib/storefront/source-language/tsx-source-language";
import { isValidThemeContentSlotId } from "@/lib/storefront/theme-content-slots";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

const ROUTE = "src/routes/index.tsx";
const HERO = "src/components/Hero.tsx";
const PROMO = "src/components/Promo.tsx";

const fieldsComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function ${name}({ title = "Default title", subtitle = "Default subtitle" }) {
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
import Promo from "../components/Promo";
`;

/** A route from its parts; the defaults are the first version's provable chain. */
const route = (parts: {
  serverFn?: string;
  routePath?: string;
  loader?: string;
  body?: string;
}) => `${IMPORTS}
${parts.serverFn ?? 'const getHome = createServerFn().handler(() => morph.pages.get("/"));'}

export const Route = createFileRoute(${JSON.stringify(parts.routePath ?? "/")})({
  loader: ${parts.loader ?? "() => getHome()"},
  component: Home,
});

function Home() {
${parts.body ?? "  const { hero } = Route.useLoaderData();\n  return <main><Hero {...hero} /></main>;"}
}`;

const CASE_B_ROUTE = route({});

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

const themeFiles = (
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) => [
  ...livePreviewPlatformFiles(),
  { path: HERO, content: fieldsComponent("Hero") },
  { path: PROMO, content: fieldsComponent("Promo") },
  { path: ROUTE, content: routeSource },
  ...extra,
];

async function render(
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) {
  return renderLivePreviewRoute({
    files: themeFiles(routeSource, extra),
    documents: { index: HOME },
  });
}

/** The section ids the route lists, as the Sections panel, Document and server read them. */
const routeSlotIds = (
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) =>
  deriveThemeRouteSections(themeFiles(routeSource, extra), ROUTE).sections.map(
    (section) => section.slotId,
  );

/** The route module as the preview serves it, after the identity pass. */
const previewedRoute = (
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) =>
  prepareSourcesForLivePreview(themeFiles(routeSource, extra)).files.find(
    (file) => file.path === ROUTE,
  )?.content ?? "";

const HERO_WRAPPER = 'data-storefront-section-id="hero"';

function expectBound(
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) {
  expect(routeSlotIds(routeSource, extra)).toContain("hero");
  expect(previewedRoute(routeSource, extra)).toContain(HERO_WRAPPER);
}

function expectNotBound(
  routeSource: string,
  extra: ReadonlyArray<{ path: string; content: string }> = [],
) {
  expect(routeSlotIds(routeSource, extra)).not.toContain("hero");
  expect(previewedRoute(routeSource, extra)).not.toContain(HERO_WRAPPER);
}

describe("case B: server function → loader → useLoaderData", () => {
  it("renders the stored values through the server function, the loader and useLoaderData", async () => {
    const { html, prepared } = await render(CASE_B_ROUTE);
    expect(prepared.bindings.skipped).toEqual([]);
    expect(html).toContain("Stored title");
    expect(html).toContain("Stored subtitle");
    expect(html).not.toContain("Default title");
  });

  it("lists <Hero {...hero}> as the route's `hero` section", () => {
    expect(routeSlotIds(CASE_B_ROUTE)).toEqual(["hero"]);
  });

  it("wraps <Hero {...hero}> as the `hero` section, and a click on its heading selects `hero`'s `title`", async () => {
    const { html } = await render(CASE_B_ROUTE);
    expect(html).toContain(HERO_WRAPPER);
    const root = mountLivePreview(html);
    const heading = resolveSelectable(root.querySelector("h1"));
    expect(heading?.sectionId).toBe("hero");
    expect(heading?.fieldKey).toBe("title");
    const subtitle = resolveSelectable(root.querySelector("p"));
    expect(subtitle?.sectionId).toBe("hero");
    expect(subtitle?.fieldKey).toBe("subtitle");
  });

  it("does not offer a disabled loader slot as a selectable content field", async () => {
    // Same valid route and component as the positive case above. Only the
    // stored section's enabled state changes: the normal loader chain must
    // not turn a hidden Document slot into an editable default-valued Hero.
    const hidden: StorefrontPageDocument = {
      ...HOME,
      sections: HOME.sections.map((section) => ({
        ...section,
        enabled: false,
      })),
    };
    const { html, prepared } = await renderLivePreviewRoute({
      files: themeFiles(CASE_B_ROUTE),
      documents: { index: hidden },
    });
    expect(prepared.bindings.skipped).toEqual([]);
    // A missing fixture or failed content read cannot satisfy this test:
    // Core did exclude the hidden value, while the positive case renders it.
    expect(html).not.toContain("Stored title");
    const root = mountLivePreview(html);
    const heading = root.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Default title");
    expect(resolveSelectable(heading)).toBeNull();
  });

  it("keeps two loader slot instances of the same component distinct", async () => {
    const source = route({ body: '  const { hero, promo } = Route.useLoaderData();\n  return <main><Hero {...hero} /><Hero {...promo} /></main>;' });
    const { html, prepared } = await renderLivePreviewRoute({
      files: themeFiles(source),
      documents: { index: {
        ...HOME,
        sections: [...HOME.sections, { id: "promo", type: "hero", enabled: true, props: { title: "Promo title", subtitle: "Promo subtitle" } }],
      } as StorefrontPageDocument },
    });
    expect(prepared.bindings.skipped).toEqual([]);
    const root = mountLivePreview(html);
    const headings = root.querySelectorAll("h1");
    expect(headings).toHaveLength(2);
    expect(headings[0]?.textContent).toBe("Stored title");
    expect(headings[1]?.textContent).toBe("Promo title");
    expect(resolveSelectable(headings[0]!)?.sectionId).toBe("hero");
    expect(resolveSelectable(headings[1]!)?.sectionId).toBe("promo");
    expect(resolveSelectable(headings[0]!)?.fieldPath).toBe("title");
    expect(resolveSelectable(headings[1]!)?.fieldPath).toBe("title");
  });

  it("refuses a handwritten marker conflicting with the loader component's source", async () => {
    const files = themeFiles(CASE_B_ROUTE).map((file) => file.path === HERO
      ? { ...file, content: file.content.replace("<h1>", '<h1 data-storefront-field="subtitle">') }
      : file);
    const { html, prepared } = await renderLivePreviewRoute({ files, documents: { index: HOME } });
    expect(prepared.bindings.skipped).toEqual([]);
    const root = mountLivePreview(html);
    const heading = root.querySelector("h1");
    expect(heading?.textContent).toBe("Stored title");
    expect(heading?.getAttribute("data-morph-field-refused")).toBe("conflict");
    const selection = resolveSelectable(heading);
    expect(selection?.sectionId).toBe("hero");
    expect(selection?.contentUnavailable).toBe("marker-conflicts-source");
    expect(selection?.fieldKey).toBeNull();
  });

  it("still names no Document section where the source cannot be confirmed, so nothing can be written there", async () => {
    // The handler changes what it read, so the link from `hero` to the page's
    // `hero` slot is not proven. The page still renders; a click on the
    // heading names Hero's own field, but its section is Hero's own root,
    // identified by its source file — not a slot id, so it cannot name a
    // Document section, and the server refuses an id the Document does not
    // have (storefront-theme.dal.test.ts).
    const unproven = route({
      serverFn: `const getHome = createServerFn().handler(async () => {
  const page = await morph.pages.get("/");
  return { ...page, hero: { ...page.hero, subtitle: "Changed in the handler" } };
});`,
    });
    const { html } = await render(unproven);
    expect(html).toContain("Changed in the handler");
    expect(html).not.toContain(HERO_WRAPPER);
    const root = mountLivePreview(html);
    const heading = resolveSelectable(root.querySelector("h1"));
    expect(heading?.fieldKey).toBe("title");
    expect(heading?.sectionId).not.toBe("hero");
    expect(isValidThemeContentSlotId(heading?.sectionId)).toBe(false);
  });

  it("keeps its sections' structure in Code: no reorder or removal from the editor", () => {
    // Structure edits write `{...content("x")}` call sites; a route whose
    // sections come from its loader is left to the author (§5.1).
    const files = themeFiles(
      route({
        body: `  const { hero, promo } = Route.useLoaderData();
  return <main><Hero {...hero} /><Promo {...promo} /></main>;`,
      }),
    );
    const source = files.find((file) => file.path === ROUTE)!.content;
    expect(deriveThemeRouteSections(files, ROUTE).sections.map((s) => s.slotId)).toEqual([
      "hero",
      "promo",
    ]);
    const reordered = reorderThemeRouteSections(source, files, ROUTE, [
      "promo",
      "hero",
    ]);
    expect(reordered.changed).toBe(false);
    expect(reordered.diagnostic).toMatch(/route loader/);
    const removed = removeThemeRouteSection(source, files, ROUTE, "promo");
    expect(removed.changed).toBe(false);
    expect(removed.diagnostic).toMatch(/route loader/);
  });
});

/**
 * A hidden section is not selectable (§6). The content runtime leaves a
 * hidden slot out of the page and lists it in `_hidden`; the author's
 * `<Hero {...hero} />` still renders, with the component's defaults. The
 * preview reads `_hidden` from the same loader data the slot came from and
 * marks the section's wrapper; the editor offers nothing inside it.
 */
describe("case B: a hidden section", () => {
  const withSections = (
    ...sections: Array<{ id: string; enabled: boolean; title: string }>
  ) =>
    ({
      version: 1,
      sections: sections.map(({ id, enabled, title }) => ({
        id,
        type: "hero",
        enabled,
        props: { title, subtitle: `${title} subtitle` },
      })),
    }) as StorefrontPageDocument;

  const renderRoute = async (
    routeSource: string,
    document: StorefrontPageDocument,
  ) => {
    const { html, prepared } = await renderLivePreviewRoute({
      files: themeFiles(routeSource),
      documents: { index: document },
    });
    expect(prepared.bindings.skipped).toEqual([]);
    return mountLivePreview(html);
  };

  const wrapperOf = (root: HTMLElement, slotId: string) =>
    root.querySelector<HTMLElement>(`[data-storefront-section-id="${slotId}"]`);

  it("names the same attribute the editor reads", () => {
    expect(PREVIEW_SECTION_HIDDEN_ATTRIBUTE).toBe(SECTION_HIDDEN_ATTRIBUTE);
  });

  it("is selectable again as `hero.title` once the same section is shown", async () => {
    const hiddenRoot = await renderRoute(
      CASE_B_ROUTE,
      withSections({ id: "hero", enabled: false, title: "Stored title" }),
    );
    expect(wrapperOf(hiddenRoot, "hero")?.hasAttribute(SECTION_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(resolveSelectable(hiddenRoot.querySelector("h1"))).toBeNull();

    const shownRoot = await renderRoute(
      CASE_B_ROUTE,
      withSections({ id: "hero", enabled: true, title: "Stored title" }),
    );
    expect(wrapperOf(shownRoot, "hero")?.hasAttribute(SECTION_HIDDEN_ATTRIBUTE)).toBe(false);
    const heading = resolveSelectable(shownRoot.querySelector("h1"));
    expect(heading?.element.textContent).toBe("Stored title");
    expect(heading?.sectionId).toBe("hero");
    expect(heading?.fieldKey).toBe("title");
    expect(heading?.fieldPath).toBe("title");
  });

  it("leaves a visible section next to it selectable, and only that one", async () => {
    const root = await renderRoute(
      route({
        body: "  const { hero, promo } = Route.useLoaderData();\n  return <main><Hero {...hero} /><Promo {...promo} /></main>;",
      }),
      withSections(
        { id: "hero", enabled: false, title: "Stored title" },
        { id: "promo", enabled: true, title: "Promo title" },
      ),
    );
    const [heroHeading, promoHeading] = Array.from(root.querySelectorAll("h1"));
    expect(heroHeading?.textContent).toBe("Default title");
    expect(promoHeading?.textContent).toBe("Promo title");
    expect(wrapperOf(root, "hero")?.hasAttribute(SECTION_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(wrapperOf(root, "promo")?.hasAttribute(SECTION_HIDDEN_ATTRIBUTE)).toBe(false);

    expect(resolveSelectable(heroHeading!)).toBeNull();
    expect(resolveSelectable(wrapperOf(root, "hero"))).toBeNull();
    const promo = resolveSelectable(promoHeading!);
    expect(promo?.sectionId).toBe("promo");
    expect(promo?.fieldKey).toBe("title");

    // The tree and a container's fields read the same way a click does.
    const treeSections = new Set(
      collectPreviewEditableNodes(root).map((node) => node.sectionId),
    );
    expect(treeSections.has("promo")).toBe(true);
    expect(treeSections.has("hero")).toBe(false);
    expect(
      collectEditableDescendantFields(root).map(
        (field) => `${field.sectionId}.${field.fieldPath}`,
      ),
    ).toEqual(["promo.title", "promo.subtitle"]);
  });

  it("is not selectable when the whole page is read as `home.hero`, and is once shown", async () => {
    const source = route({
      body: "  const home = Route.useLoaderData();\n  return <main><Hero {...home.hero} /></main>;",
    });
    const hiddenRoot = await renderRoute(
      source,
      withSections({ id: "hero", enabled: false, title: "Stored title" }),
    );
    expect(hiddenRoot.querySelector("h1")?.textContent).toBe("Default title");
    expect(resolveSelectable(hiddenRoot.querySelector("h1"))).toBeNull();

    const shownRoot = await renderRoute(
      source,
      withSections({ id: "hero", enabled: true, title: "Stored title" }),
    );
    const heading = resolveSelectable(shownRoot.querySelector("h1"));
    expect(heading?.sectionId).toBe("hero");
    expect(heading?.fieldKey).toBe("title");
  });

  it('leaves the `content("x")` path as it was: the author\'s guard, no marker', async () => {
    const source = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <main>{!isSectionHidden("hero") && <Hero {...content("hero")} />}</main>;
}`;
    const previewed =
      prepareSourcesForLivePreview(themeFiles(source)).files.find(
        (file) => file.path === ROUTE,
      )?.content ?? "";
    expect(previewed).toContain(HERO_WRAPPER);
    expect(previewed).not.toContain(SECTION_HIDDEN_ATTRIBUTE);
    expect(previewed).not.toContain("_hidden");

    const hiddenRoot = await renderRoute(
      source,
      withSections({ id: "hero", enabled: false, title: "Stored title" }),
    );
    expect(hiddenRoot.querySelector("h1")).toBeNull();

    const shownRoot = await renderRoute(
      source,
      withSections({ id: "hero", enabled: true, title: "Stored title" }),
    );
    expect(wrapperOf(shownRoot, "hero")?.hasAttribute(SECTION_HIDDEN_ATTRIBUTE)).toBe(false);
    const heading = resolveSelectable(shownRoot.querySelector("h1"));
    expect(heading?.element.textContent).toBe("Stored title");
    expect(heading?.sectionId).toBe("hero");
    expect(heading?.fieldKey).toBe("title");
  });
});

/**
 * Shapes the first version binds. Each refusal below is the nearest of these
 * with one rule broken.
 */
describe("case B: shapes the first version binds", () => {
  it("an async handler that awaits the read", () => {
    expectBound(
      route({
        serverFn:
          'const getHome = createServerFn().handler(async () => await morph.pages.get("/"));',
      }),
    );
  });

  it("a handler that names the read once and returns it", () => {
    expectBound(
      route({
        serverFn: `const getHome = createServerFn().handler(async () => {
  const page = await morph.pages.get("/");
  return page;
});`,
      }),
    );
  });

  it("a server function with options", () => {
    expectBound(
      route({
        serverFn:
          'const getHome = createServerFn({ method: "GET" }).handler(() => morph.pages.get("/"));',
      }),
    );
  });

  it("an async loader that awaits the server function", () => {
    expectBound(route({ loader: "async () => await getHome()" }));
  });

  it("a renamed binding", () => {
    expectBound(
      route({
        body: "  const { hero: banner } = Route.useLoaderData();\n  return <main><Hero {...banner} /></main>;",
      }),
    );
  });

  it("the whole page, read by a literal key", () => {
    expectBound(
      route({
        body: "  const home = Route.useLoaderData();\n  return <main><Hero {...home.hero} /></main>;",
      }),
    );
  });

  it("a key beside the spread", () => {
    expectBound(
      route({
        body: '  const { hero } = Route.useLoaderData();\n  return <main><Hero key="hero" {...hero} /></main>;',
      }),
    );
  });

  it("a server function imported from a Theme file by a relative path", () => {
    expectBound(
      route({
        serverFn: 'import { getHome } from "../server/home";',
      }),
      [
        {
          path: "src/server/home.ts",
          content: `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`,
        },
      ],
    );
  });

  it("a route path with a trailing slash", () => {
    expectBound(
      route({
        routePath: "/pages/about/",
        serverFn:
          'const getHome = createServerFn().handler(() => morph.pages.get("/pages/about"));',
      }),
    );
  });
});

describe("case B: shapes the first version refuses", () => {
  it("a path that is not a string literal", () => {
    expectNotBound(
      route({
        serverFn: `const path = "/";
const getHome = createServerFn().handler(() => morph.pages.get(path));`,
      }),
    );
  });

  it('another page\'s content ("/home" is not the "/" route\'s page)', () => {
    expectNotBound(
      route({
        serverFn:
          'const getHome = createServerFn().handler(() => morph.pages.get("/home"));',
      }),
    );
  });

  it("a route whose path is not one fixed page", () => {
    expectNotBound(
      route({
        routePath: "/products/$slug",
        serverFn:
          'const getHome = createServerFn().handler(() => morph.pages.get("/products/$slug"));',
      }),
    );
  });

  it("a handler that transforms what it read", () => {
    expectNotBound(
      route({
        serverFn: `const getHome = createServerFn().handler(async () => {
  const page = await morph.pages.get("/");
  return { ...page, hero: { ...page.hero, title: "Sale" } };
});`,
      }),
    );
  });

  it("a handler that takes input", () => {
    expectNotBound(
      route({
        serverFn:
          'const getHome = createServerFn().handler(({ data }) => morph.pages.get("/"));',
      }),
    );
  });

  it("a server function with middleware", () => {
    expectNotBound(
      route({
        serverFn:
          'const getHome = createServerFn().middleware([]).handler(() => morph.pages.get("/"));',
      }),
    );
  });

  it("a server function re-exported through a second module", () => {
    // The first module resolves (so the refusal is the re-export rule, not a
    // missing file); it only forwards `getHome` from another.
    expectNotBound(
      route({
        serverFn: 'import { getHome } from "../server/forward";',
      }),
      [
        {
          path: "src/server/forward.ts",
          content: 'export { getHome } from "./home";',
        },
        {
          path: "src/server/home.ts",
          content: `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`,
        },
      ],
    );
  });

  it("a loader that wraps the result in an object", () => {
    expectNotBound(
      route({
        loader: "async () => ({ home: await getHome() })",
        body: "  const { home } = Route.useLoaderData();\n  return <main><Hero {...home.hero} /></main>;",
      }),
    );
  });

  it("a loader that adds to the result", () => {
    expectNotBound(route({ loader: "async () => ({ ...(await getHome()), extra: 1 })" }));
  });

  it("a destructuring default", () => {
    expectNotBound(
      route({
        body: "  const { hero = {} } = Route.useLoaderData();\n  return <main><Hero {...hero} /></main>;",
      }),
    );
  });

  it("a rest element in the destructuring", () => {
    expectNotBound(
      route({
        body: "  const { hero, ...rest } = Route.useLoaderData();\n  return <main><Hero {...hero} /></main>;",
      }),
    );
  });

  it("a binding that is reassigned", () => {
    expectNotBound(
      route({
        body: `  let { hero } = Route.useLoaderData();
  hero = { ...hero, title: "Sale" };
  return <main><Hero {...hero} /></main>;`,
      }),
    );
  });

  it("a binding read anywhere besides its spread", () => {
    expectNotBound(
      route({
        body: "  const { hero } = Route.useLoaderData();\n  return <main><Hero {...hero} />{hero.title}</main>;",
      }),
    );
  });

  it("a name redeclared in an inner scope", () => {
    expectNotBound(
      route({
        body: `  const { hero } = Route.useLoaderData();
  function Inner() {
    const hero = { title: "Sale" };
    return <Hero {...hero} />;
  }
  return <main><Inner /></main>;`,
      }),
    );
  });

  it("a literal after the spread is not claimed, while the other stored fields remain editable", async () => {
    const source = route({
      body: '  const { hero } = Route.useLoaderData();\n  return <main><Hero {...hero} title="Sale" /></main>;',
    });
    const { html } = await render(source);
    const root = mountLivePreview(html);
    const title = resolveSelectable(root.querySelector("h1"));
    const subtitle = resolveSelectable(root.querySelector("p"));

    expect(routeSlotIds(source)).toEqual(["hero"]);
    expect(title?.element.textContent).toBe("Sale");
    expect(title?.sectionId).toBe("hero");
    expect(title?.fieldKey).toBeNull();
    expect(subtitle?.element.textContent).toBe("Stored subtitle");
    expect(subtitle?.sectionId).toBe("hero");
    expect(subtitle?.fieldKey).toBe("subtitle");

    const files = themeFiles(source);
    const reordered = reorderThemeRouteSections(source, files, ROUTE, ["hero"]);
    expect(reordered.changed).toBe(false);
    expect(reordered.diagnostic).toMatch(/route loader/);
  });

  it("another spread on the same element", () => {
    expectNotBound(
      route({
        body: `  const { hero } = Route.useLoaderData();
  const defaults = { subtitle: "Sale" };
  return <main><Hero {...defaults} {...hero} /></main>;`,
      }),
    );
  });

  it("one slot shown in two places", () => {
    expectNotBound(
      route({
        body: "  const home = Route.useLoaderData();\n  return <main><Hero {...home.hero} /><Hero {...home.hero} /></main>;",
      }),
    );
  });
});

/**
 * The route options object is read as the runtime reads it. The proven
 * `loader` must be the one that runs: the last of two, a computed key or a
 * spread could replace it, and a method is not the proven shape.
 */
describe("case B: route options the first version refuses", () => {
  const withOptions = (options: string) =>
    `${IMPORTS}
const getHome = createServerFn().handler(() => morph.pages.get("/"));
const getOther = createServerFn().handler(() => morph.pages.get("/"));
const shared = { loader: () => getOther() };

export const Route = createFileRoute("/")({
${options}
});

function Home() {
  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} /></main>;
}`;

  it("binds the plain options this group varies", () => {
    expectBound(withOptions("  loader: () => getHome(),\n  component: Home,"));
  });

  it("a loader stated twice (the last one runs)", () => {
    expectNotBound(
      withOptions(
        "  loader: () => getHome(),\n  component: Home,\n  loader: () => getOther(),",
      ),
    );
  });

  it("a component stated twice", () => {
    expectNotBound(
      withOptions(
        "  loader: () => getHome(),\n  component: Home,\n  component: Home,",
      ),
    );
  });

  it("a computed option key", () => {
    expectNotBound(
      withOptions('  ["loader"]: () => getHome(),\n  component: Home,'),
    );
  });

  it("a spread into the options", () => {
    expectNotBound(
      withOptions("  loader: () => getHome(),\n  ...shared,\n  component: Home,"),
    );
  });

  it("a loader written as a method", () => {
    expectNotBound(
      withOptions("  loader() {\n    return getHome();\n  },\n  component: Home,"),
    );
  });
});

/**
 * `createServerFn` and `morph` are the ones the analysis means only when they
 * are imported from where those functions live, under one name nothing else in
 * the module reuses.
 */
describe("case B: imports the first version refuses", () => {
  const withImports = (imports: string, extra = "") =>
    `import { createFileRoute } from "@tanstack/react-router";
${imports}
import Hero from "../components/Hero";
${extra}
const getHome = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} /></main>;
}`;
  const START = 'import { createServerFn } from "@tanstack/react-start";';
  const MORPH = 'import { morph } from "../morph/content";';

  it("binds the imports this group varies", () => {
    expectBound(withImports(`${START}\n${MORPH}`));
  });

  it("createServerFn from a module other than @tanstack/react-start", () => {
    expectNotBound(
      withImports(
        `import { createServerFn } from "../server/fake-start";\n${MORPH}`,
      ),
      [
        {
          path: "src/server/fake-start.ts",
          content:
            "export const createServerFn = () => ({ handler: (fn: () => unknown) => fn });",
        },
      ],
    );
  });

  it("another @tanstack/react-start export under the name createServerFn", () => {
    expectNotBound(
      withImports(
        `import { createIsomorphicFn as createServerFn } from "@tanstack/react-start";\n${MORPH}`,
      ),
    );
  });

  it("createServerFn redeclared elsewhere in the module", () => {
    expectNotBound(
      withImports(
        `${START}\n${MORPH}`,
        "function unrelated(createServerFn: unknown) {\n  return createServerFn;\n}",
      ),
    );
  });

  it("morph from a module that is not the Theme's content module", () => {
    expectNotBound(
      withImports(`${START}\nimport { morph } from "../morph/other";`),
      [
        {
          path: "src/morph/other.ts",
          content:
            'export const morph = { pages: { get: async (path: string) => ({ path }) } };',
        },
      ],
    );
  });
});

/**
 * One import, one file, read the same way by the route's section list (what
 * the Sections panel, the Document and the server's write check use) and by
 * the preview's identity pass (what a click reads). Each case states whether
 * it binds; both readers must agree on it.
 */
describe("case B: cross-file server functions read the same way everywhere", () => {
  const SERVER_MODULE = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`;

  const cases: ReadonlyArray<{
    name: string;
    specifier: string;
    files: ReadonlyArray<{ path: string; content: string }>;
    bound: boolean;
  }> = [
    {
      name: "a .ts file named without its extension",
      specifier: "../server/home",
      files: [{ path: "src/server/home.ts", content: SERVER_MODULE }],
      bound: true,
    },
    {
      name: "a .ts file named with its extension",
      specifier: "../server/home.ts",
      files: [{ path: "src/server/home.ts", content: SERVER_MODULE }],
      bound: true,
    },
    {
      name: "a folder's index.ts",
      specifier: "../server",
      files: [{ path: "src/server/index.ts", content: SERVER_MODULE }],
      bound: true,
    },
    {
      name: "a .tsx file",
      specifier: "../server/home",
      files: [{ path: "src/server/home.tsx", content: SERVER_MODULE }],
      bound: true,
    },
    {
      name: "a file that is not there",
      specifier: "../server/missing",
      files: [],
      bound: false,
    },
    {
      name: "a deeper module importing morph by its own relative path",
      specifier: "../server/deep/home",
      files: [
        {
          path: "src/server/deep/home.ts",
          content: SERVER_MODULE.replace("../morph/content", "../../morph/content"),
        },
      ],
      bound: true,
    },
    {
      name: "a module whose own morph import does not reach the content module",
      specifier: "../server/deep/home",
      files: [
        {
          // From src/server/deep/ this names src/server/morph/content, which is
          // not the content module — though from the route it would be.
          path: "src/server/deep/home.ts",
          content: SERVER_MODULE,
        },
      ],
      bound: false,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.bound ? "binds" : "refuses"} ${testCase.name}`, () => {
      const source = route({
        serverFn: `import { getHome } from ${JSON.stringify(testCase.specifier)};`,
      });
      const listed = routeSlotIds(source, testCase.files).includes("hero");
      const wrapped = previewedRoute(source, testCase.files).includes(
        HERO_WRAPPER,
      );
      expect({ listed, wrapped }).toEqual({
        listed: testCase.bound,
        wrapped: testCase.bound,
      });
    });
  }
});
