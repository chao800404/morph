/**
 * A prop set at a section's call site next to its content spread.
 *
 * `<Hero {...content("hero")} title={other.title} />`: JSX hands Hero one
 * props object built left to right, so the later `title` replaces the one the
 * spread brought. The page shows `other.title`; Hero's `<h1>{title}</h1>` is
 * not `hero.title`, and claiming it as that wrote the wrong field.
 *
 * Every case renders the Theme with real React after the Live Preview's own
 * source pass and reads each element with the resolution the canvas bridge
 * runs. Nothing of the binding logic is stubbed. Where the code's text and the
 * stored text are the same ("Sale"), the location still has to come from the
 * source: the text alone cannot say which one won.
 *
 * Two spellings:
 *
 * - `content("hero")`, which the section analysis binds whatever else the call
 *   site sets: a prop that can replace one of the section's declared fields
 *   (a later attribute of that name, or a later spread, which may set any)
 *   leaves this instance naming no field, through the same empty thread a
 *   component nested inside a section gets. The section is still bound, so its
 *   stored content still renders and saves.
 * - The loader form (`const { hero } = Route.useLoaderData()`), which already
 *   binds only a spread with nothing but `key` beside it: the element is not
 *   the section's at all.
 *
 * A prop written before the spread is a default the spread replaces whenever
 * the stored content has that field, and that is when a write lands: so it
 * stays the section's field, as a component default does, including while
 * the stored content lacks it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

type File = { path: string; content: string };
type Props = Record<string, string>;

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const ROUTE = "src/routes/index.tsx";

const HERO: File = {
  path: "src/components/Hero.tsx",
  content: `export const contentFields = {
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
}`,
};

/** A route reading its content with `content("x")`. `$hero` is the spread. */
function contentRoute(body: string): File {
  return {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
const extra = { title: "Fixed text" };
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const other = content("other");
  return <main>${body.replaceAll("$hero", 'content("hero")').replaceAll("$plain", 'content("plain")')}</main>;
}`,
  };
}

/** The same body, read through the route's loader. */
function loaderRoute(body: string): File {
  return {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const extra = { title: "Fixed text" };
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { hero, other, plain } = Route.useLoaderData();
  return <main>${body.replaceAll("$hero", "hero").replaceAll("$plain", "plain")}</main>;
}`,
  };
}

const SPELLINGS = [
  ['content("hero")', contentRoute],
  ["the loader form", loaderRoute],
] as const;

function page(sections: Record<string, Props>): StorefrontPageDocument {
  return {
    version: 1,
    sections: Object.entries(sections).map(([id, props]) => ({
      id,
      type: "hero",
      enabled: true,
      props: { ...props },
    })),
  } as unknown as StorefrontPageDocument;
}

async function mount(route: File, sections: Record<string, Props>) {
  const { html } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), HERO, route],
    documents: { index: page(sections) },
  });
  return mountLivePreview(
    `<div id="root" data-morph-route-path="/">${html}</div>`,
  );
}

function all(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function only(root: HTMLElement, selector: string): HTMLElement {
  const found = all(root, selector);
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** What a click on `element` selects, in the fields the editor writes from. */
function clicked(element: HTMLElement) {
  const item = resolveSelectable(element);
  return {
    sectionId: item?.sectionId ?? null,
    fieldKey: item?.fieldKey ?? null,
    fieldPath: item?.fieldPath ?? null,
  };
}

/** Whether a click on `element` names a field of the `hero` section. */
function claimsHero(element: HTMLElement) {
  const { sectionId, fieldKey } = clicked(element);
  return sectionId === "hero" && fieldKey !== null;
}

const SALE = { title: "Sale", subtitle: "Stored subtitle" };

describe("a prop set after the spread replaces the section's field", () => {
  const overriding = [
    [
      "a literal",
      `<Hero {...$hero} title="Fixed text" />`,
      { hero: { title: "Stored title", subtitle: "Stored subtitle" } },
      "Fixed text",
    ],
    [
      "a literal equal to the stored title",
      `<Hero {...$hero} title="Sale" />`,
      { hero: SALE },
      "Sale",
    ],
    [
      "another section's title (C4b)",
      `<Hero {...$hero} title={other.title} />`,
      {
        hero: { title: "Hero title", subtitle: "Stored subtitle" },
        other: { title: "Other title", subtitle: "Other subtitle" },
      },
      "Other title",
    ],
    [
      "another section's title, equal to the stored title",
      `<Hero {...$hero} title={other.title} />`,
      { hero: SALE, other: { title: "Sale", subtitle: "Other subtitle" } },
      "Sale",
    ],
    [
      "a later spread, which may set any prop",
      `<Hero {...$hero} {...extra} />`,
      { hero: { title: "Stored title", subtitle: "Stored subtitle" } },
      "Fixed text",
    ],
  ] as const;

  describe.each(SPELLINGS)("%s", (_spelling, route) => {
    it.each(overriding)(
      "%s: the title shown is not claimed as hero.title",
      async (_, body, sections, shown) => {
        const root = await mount(route(body), sections);
        const h1 = only(root, "h1");
        // The source that wins is the one the page shows.
        expect(h1.textContent).toBe(shown);
        expect(claimsHero(h1)).toBe(false);
        expect(
          clicked(h1).fieldKey === "title" && clicked(h1).sectionId === "hero",
        ).toBe(false);
      },
    );
  });

  it.each(overriding)(
    'content("hero"), %s: the section stays bound, the title names nothing, and a field the call site leaves alone stays the section\'s',
    async (_, body, sections, shown) => {
      const root = await mount(contentRoute(body), sections);
      const h1 = only(root, "h1");
      expect(h1.textContent).toBe(shown);
      // Selectable as an element of the section, with nothing to edit.
      expect(h1.getAttribute("data-storefront-field")).toBe("");
      expect(clicked(h1)).toEqual({
        sectionId: "hero",
        fieldKey: null,
        fieldPath: null,
      });
      // The stored subtitle still renders, and the call site does not set
      // it, so it is still the section's field. A later spread may set any
      // prop, so after one it is not.
      const p = only(root, "p");
      expect(p.textContent).toBe("Stored subtitle");
      expect(clicked(p)).toEqual(
        body.includes("{...extra}")
          ? { sectionId: "hero", fieldKey: null, fieldPath: null }
          : { sectionId: "hero", fieldKey: "subtitle", fieldPath: "subtitle" },
      );
      expect(
        all(root, "[data-storefront-section-id]").map(
          (element) => element.dataset.storefrontSectionId,
        ),
      ).toEqual(["hero"]);
    },
  );

  it("the loader form selectively binds only the field the spread supplies", async () => {
    const root = await mount(loaderRoute(`<Hero {...$hero} title="Sale" />`), {
      hero: SALE,
    });
    expect(all(root, '[data-storefront-section-id="hero"]')).toHaveLength(1);
    const heading = only(root, "h1");
    expect(heading.textContent).toBe("Sale");
    expect(clicked(heading)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
    expect(heading.getAttribute("data-morph-binding-state")).toBe("not-cms");
    expect(clicked(only(root, "p"))).toEqual({
      sectionId: "hero",
      fieldKey: "subtitle",
      fieldPath: "subtitle",
    });
  });

  it("only the instance that overrides refuses: the same Hero elsewhere keeps its fields", async () => {
    const root = await mount(
      contentRoute(`<Hero {...$hero} title="Sale" /><Hero {...$plain} />`),
      { hero: SALE, plain: { title: "Sale", subtitle: "Plain subtitle" } },
    );
    const [overridden, plain] = all(root, "h1");
    expect(overridden!.textContent).toBe("Sale");
    expect(clicked(overridden!).fieldKey).toBeNull();
    expect(clicked(all(root, "p")[0]!)).toEqual({
      sectionId: "hero",
      fieldKey: "subtitle",
      fieldPath: "subtitle",
    });
    expect(plain!.textContent).toBe("Sale");
    expect(clicked(plain!)).toEqual({
      sectionId: "plain",
      fieldKey: "title",
      fieldPath: "title",
    });
    expect(clicked(all(root, "p")[1]!)).toEqual({
      sectionId: "plain",
      fieldKey: "subtitle",
      fieldPath: "subtitle",
    });
  });

  it.each([
    ["a prop Hero does not declare", `<Hero {...$hero} className="wide" />`],
    ["a key", `<Hero key="k" {...$hero} />`],
  ])(
    'content("hero"), %s, replaces no field: the fields stay the section\'s',
    async (_, body) => {
      const root = await mount(contentRoute(body), {
        hero: { title: "Stored title", subtitle: "Stored subtitle" },
      });
      expect(clicked(only(root, "h1"))).toEqual({
        sectionId: "hero",
        fieldKey: "title",
        fieldPath: "title",
      });
      expect(clicked(only(root, "p"))).toEqual({
        sectionId: "hero",
        fieldKey: "subtitle",
        fieldPath: "subtitle",
      });
    },
  );
});

describe("where the empty thread cannot reach every element, the call site is not the section", () => {
  async function mountWith(
    component: File,
    body: string,
    sections: Record<string, Props>,
  ) {
    const { html } = await renderLivePreviewRoute({
      files: [...livePreviewPlatformFiles(), component, contentRoute(body)],
      documents: { index: page(sections) },
    });
    return mountLivePreview(
      `<div id="root" data-morph-route-path="/">${html}</div>`,
    );
  }

  it("a Hero that takes its props whole", async () => {
    const whole: File = {
      path: HERO.path,
      content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero(props) {
  const { title = "Default title", subtitle = "Default subtitle" } = props;
  return <section><h1>{title}</h1><p>{subtitle}</p></section>;
}`,
    };
    const root = await mountWith(whole, `<Hero {...$hero} title="Sale" />`, {
      hero: SALE,
    });
    expect(only(root, "h1").textContent).toBe("Sale");
    expect(all(root, '[data-storefront-section-id="hero"]')).toHaveLength(0);
    expect(claimsHero(only(root, "h1"))).toBe(false);
    expect(claimsHero(only(root, "p"))).toBe(false);
  });

  it.each([
    ["the list itself", `<List {...$hero} items={other.items} />`],
    ["any prop, by a later spread", `<List {...$hero} {...extra} />`],
  ])("a list replaced by %s", async (_, body) => {
    const list: File = {
      path: HERO.path,
      content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: { type: "array", fields: { label: { type: "text" } } },
};
export default function List({ heading = "", items = [] }) {
  return <section><h2>{heading}</h2><ul>{items.map((item, index) => <li key={item.id}>{item.label}</li>)}</ul></section>;
}`,
    };
    const root = await mountWith(list, body.replaceAll("List", "Hero"), {
      hero: {
        heading: "Sale",
        items: [{ id: "a", label: "Sale" }] as unknown as string,
      },
      other: {
        heading: "Other",
        items: [{ id: "b", label: "Sale" }] as unknown as string,
      },
    });
    expect(all(root, '[data-storefront-section-id="hero"]')).toHaveLength(0);
    for (const element of [...all(root, "li"), only(root, "h2")]) {
      expect(claimsHero(element)).toBe(false);
    }
  });

  it("a Hero with a hand-written field marker, which the thread does not rewrite", async () => {
    const marked: File = {
      path: HERO.path,
      content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  return <section><h1 data-storefront-field="title">{title}</h1><p>{subtitle}</p></section>;
}`,
    };
    const root = await mountWith(marked, `<Hero {...$hero} title="Sale" />`, {
      hero: SALE,
    });
    expect(only(root, "h1").textContent).toBe("Sale");
    expect(all(root, '[data-storefront-section-id="hero"]')).toHaveLength(0);
    expect(claimsHero(only(root, "h1"))).toBe(false);
    expect(claimsHero(only(root, "p"))).toBe(false);
  });

  it("a component a list also renders as its rows names nothing at an overriding call site", async () => {
    // Its field elements build a row's path from the thread, and a section's
    // thread has none, so the call site hands it the empty one.
    const { html } = await renderLivePreviewRoute({
      files: [
        ...livePreviewPlatformFiles(),
        {
          path: "src/components/Card.tsx",
          content: `export const contentFields = {
  heading: { type: "text" },
  sub: { type: "text" },
};
export default function Card({ heading = "", sub = "" }) {
  return <article><h3>{heading}</h3><p>{sub}</p></article>;
}`,
        },
        {
          path: "src/components/List.tsx",
          content: `import Card from "./Card";
export const contentFields = {
  items: { type: "array", fields: { title: { type: "text" } } },
};
export default function List({ items = [] }) {
  return <section>{items.map((item, index) => <Card key={item.id} heading={item.title} />)}</section>;
}`,
        },
        {
          path: ROUTE,
          content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Card from "../components/Card";
import List from "../components/List";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><List {...content("list")} /><Card {...content("hero")} heading="Sale" /></main>;
}`,
        },
      ],
      documents: {
        index: {
          version: 1,
          sections: [
            {
              id: "list",
              type: "list",
              enabled: true,
              props: { items: [{ id: "r1", title: "Row" }] },
            },
            {
              id: "hero",
              type: "card",
              enabled: true,
              props: { heading: "Sale", sub: "Stored sub" },
            },
          ],
        } as unknown as StorefrontPageDocument,
      },
    });
    const root = mountLivePreview(
      `<div id="root" data-morph-route-path="/">${html}</div>`,
    );
    const [row, hero] = all(root, "article");
    expect(clicked(row!.querySelector("h3")!)).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.0.title",
    });
    expect(clicked(hero!.querySelector("h3")!)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
    expect(clicked(hero!.querySelector("p")!)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
  });

  it("a list the call site leaves alone keeps the thread: the heading it replaces names nothing", async () => {
    const list: File = {
      path: HERO.path,
      content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: { type: "array", fields: { label: { type: "text" } } },
};
export default function Hero({ heading = "", items = [] }) {
  return <section><h2>{heading}</h2><ul>{items.map((item, index) => <li key={item.id}>{item.label}</li>)}</ul></section>;
}`,
    };
    const root = await mountWith(list, `<Hero {...$hero} heading="Sale" />`, {
      hero: {
        heading: "Sale",
        items: [{ id: "a", label: "Row" }] as unknown as string,
      },
    });
    expect(all(root, '[data-storefront-section-id="hero"]')).toHaveLength(1);
    expect(clicked(only(root, "h2"))).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
    // The rows are the spread's: the call site sets no `items`.
    expect(clicked(only(root, "li"))).toEqual({
      sectionId: "hero",
      fieldKey: "label",
      fieldPath: "items.0.label",
    });
  });
});

describe("a prop set before the spread is a default the spread replaces", () => {
  it("names hero.title, which the page shows", async () => {
    const root = await mount(
      contentRoute(`<Hero title="Fixed text" {...$hero} />`),
      { hero: { title: "Stored title", subtitle: "Stored subtitle" } },
    );
    const h1 = only(root, "h1");
    expect(h1.textContent).toBe("Stored title");
    expect(clicked(h1)).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("names hero.title when the literal and the stored title are the same text", async () => {
    const root = await mount(contentRoute(`<Hero title="Sale" {...$hero} />`), {
      hero: SALE,
    });
    const h1 = only(root, "h1");
    expect(h1.textContent).toBe("Sale");
    expect(clicked(h1).fieldKey).toBe("title");
  });

  it("keeps the code literal unbound until the stored field exists", async () => {
    const files = (sections: Record<string, Props>) =>
      mount(contentRoute(`<Hero title="Fixed text" {...$hero} />`), sections);
    const before = only(
      await files({ hero: { subtitle: "Stored subtitle" } }),
      "h1",
    );
    expect(before.textContent).toBe("Fixed text");
    expect(clicked(before)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
    expect(before.getAttribute("data-morph-binding-state")).toBe("not-cms");
    // Once the stored field exists, the later spread supplies the displayed
    // value and the same element is correctly bound to that CMS field.
    const after = only(
      await files({ hero: { title: "Written", subtitle: "Stored subtitle" } }),
      "h1",
    );
    expect(after.textContent).toBe("Written");
    expect(clicked(after)).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });
});
