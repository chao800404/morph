/**
 * An element whose value cannot be traced to one field of its section offers
 * no field at all.
 *
 * Every case renders the Theme with real React after the Live Preview's own
 * source pass, under a route whose loader hands the home page's `hero` to
 * `<Hero {...hero} />` (the sole spread the ROADMAP's Start case names), and
 * reads each element with the resolution the canvas bridge runs. Nothing of
 * the binding logic is stubbed.
 *
 * Two shapes used to name the wrong field (research 2026-10-21 §4.4):
 *
 * - `{cond ? title : subtitle}` named `title` whichever branch rendered;
 * - a component Hero renders, `<Heading title={subtitle} />`, named its own
 *   prop `title`, and inside Hero's section that read as `hero.title`.
 *
 * Both now name nothing the editor can write. The values are also run equal,
 * because text the page shows is what the inline guard compares, and two
 * fields holding "Sale" would pass it for either.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { injectPreviewBindings } from "@/lib/storefront/ast/inject-preview-bindings";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

type File = { path: string; content: string };

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not, and a
  // row's selection builds its selectors with it.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const ROUTE = "src/routes/index.tsx";
const HERO = "src/components/Hero.tsx";
const HEADING = "src/components/Heading.tsx";

/** Hero, declaring `title` and `subtitle`, rendering `body`. */
function hero(body: string, preamble = ""): File {
  return {
    path: HERO,
    content: `${preamble}export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  const show = false;
  return (
    <section>
${body}
    </section>
  );
}`,
  };
}

/** Heading, declaring one field of its own, `name`. */
function heading(name: string): File {
  return {
    path: HEADING,
    content: `export const contentFields = { ${name}: { type: "text", label: "Heading ${name}" } };
export default function Heading({ ${name} = "Default heading" }) {
  return <h2>{${name}}</h2>;
}`,
  };
}

/** The supported Start shape: loader → `useLoaderData()` → `<Hero {...hero} />`. */
function route(body = "<Hero {...hero} />", imports = ""): File {
  return {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
${imports}
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { hero } = Route.useLoaderData();
  return <main>${body}</main>;
}`,
  };
}

function home(title: string, subtitle: string): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      { id: "hero", type: "hero", enabled: true, props: { title, subtitle } },
    ],
  } as unknown as StorefrontPageDocument;
}

async function mount(
  files: File[],
  document = home("Stored title", "Stored subtitle"),
) {
  const { html } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), ...files],
    documents: { index: document },
  });
  return mountLivePreview(
    `<div id="root" data-morph-route-path="/">${html}</div>`,
  );
}

function only(root: HTMLElement, selector: string): HTMLElement {
  const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
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

describe("a ternary picks one of two fields at runtime", () => {
  it("names neither, so the subtitle it shows is never written as the title", async () => {
    const root = await mount([
      hero(`      <h1>{show ? title : subtitle}</h1>`),
      route(),
    ]);
    const h1 = only(root, "h1");
    expect(h1.textContent).toBe("Stored subtitle");
    expect(h1.hasAttribute("data-storefront-field")).toBe(false);
    expect(clicked(h1)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
  });

  it("names neither when both fields hold the same text", async () => {
    const root = await mount(
      [hero(`      <h1>{show ? title : subtitle}</h1>`), route()],
      home("Sale", "Sale"),
    );
    const h1 = only(root, "h1");
    expect(h1.textContent).toBe("Sale");
    expect(clicked(h1).fieldKey).toBeNull();
  });
});

describe("a component Hero renders names its own props, not Hero's fields", () => {
  const nested = (prop: string, value: string) =>
    hero(
      `      <Heading ${prop}={${value}} />\n      <p>{title}</p>`,
      `import Heading from "./Heading";\n`,
    );

  it("offers nothing when its prop shares a name with a different Hero field", async () => {
    // Heading's `title` is Hero's subtitle here.
    const root = await mount([
      nested("title", "subtitle"),
      heading("title"),
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    // The empty field: selected as an element, with no content to edit.
    expect(h2.getAttribute("data-storefront-field")).toBe("");
    expect(clicked(h2)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
    // Hero's own element is unchanged.
    expect(clicked(only(root, "p"))).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("offers nothing when the shared name's two fields hold the same text", async () => {
    const root = await mount(
      [nested("title", "subtitle"), heading("title"), route()],
      home("Sale", "Sale"),
    );
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Sale");
    expect(clicked(h2).fieldKey).toBeNull();
  });

  it("offers nothing when its prop is a name Hero never declared", async () => {
    const root = await mount([
      nested("text", "title"),
      heading("text"),
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored title");
    expect(h2.getAttribute("data-storefront-field")).toBe("");
    expect(clicked(h2)).toEqual({
      sectionId: "hero",
      fieldKey: null,
      fieldPath: null,
    });
  });

  it("offers nothing two components down", async () => {
    // Hero → Heading → Text: Text's own claim is no more Hero's than Heading's.
    const root = await mount([
      nested("title", "subtitle"),
      {
        path: HEADING,
        content: `import Text from "./Text";
export const contentFields = { title: { type: "text" } };
export default function Heading({ title = "" }) {
  return <div><Text title={title} /></div>;
}`,
      },
      {
        path: "src/components/Text.tsx",
        content: `export const contentFields = { title: { type: "text" } };
export default function Text({ title = "" }) {
  return <h2>{title}</h2>;
}`,
      },
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    expect(clicked(h2).fieldKey).toBeNull();
  });

  it.each([
    [
      "as the section's children",
      `<Hero {...hero}><Heading title="Handed heading" /></Hero>`,
    ],
    // `content("x")` binds a section whatever else its call site sets.
    [
      "as an element prop of the section",
      `<Hero {...content("hero")} badge={<Heading title="Handed heading" />} />`,
    ],
  ])(
    "offers nothing for a component the route hands Hero %s",
    async (_, body) => {
      const withSlots = hero(`      <h1>{title}</h1>\n      {children}{badge}`);
      const root = await mount([
        {
          ...withSlots,
          content: withSlots.content.replace(
            'subtitle = "Default subtitle" }',
            'subtitle = "Default subtitle", children = null, badge = null }',
          ),
        },
        heading("title"),
        route(
          body,
          `import Heading from "../components/Heading";
import { content } from "../morph/content";`,
        ),
      ]);
      // Heading shows the route's literal, and Hero's title is not it.
      const h2 = only(root, "h2");
      expect(h2.textContent).toBe("Handed heading");
      expect(clicked(h2).fieldKey).toBeNull();
      expect(clicked(only(root, "h1"))).toEqual({
        sectionId: "hero",
        fieldKey: "title",
        fieldPath: "title",
      });
    },
  );

  it("offers nothing when Hero's call site sets the preview's own row prop", async () => {
    // The author's prop of that name is theirs: nothing is threaded through
    // it, and the component names nothing inside the section.
    const root = await mount([
      hero(
        `      <Heading __morphRow={{ fields: { title: "title" } }} title={subtitle} />`,
        `import Heading from "./Heading";\n`,
      ),
      heading("title"),
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    expect(clicked(h2).fieldKey).toBeNull();
  });

  it("offers nothing for a component that takes its props whole", async () => {
    // No destructured props to take the thread through, so it names nothing
    // anywhere once it is found inside a section.
    const root = await mount([
      nested("title", "subtitle"),
      {
        path: HEADING,
        content: `export const contentFields = { title: { type: "text" } };
export default function Heading(props) {
  const { title } = props;
  return <h2>{title}</h2>;
}`,
      },
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    expect(h2.getAttribute("data-storefront-field")).toBe("");
    expect(clicked(h2).fieldKey).toBeNull();
  });

  it("offers nothing for content such a component shows through another one", async () => {
    // `<Label>{title}</Label>`: the wrapper the preview puts around content
    // shown through a component names nothing either.
    const root = await mount([
      nested("title", "subtitle"),
      {
        path: HEADING,
        content: `import Label from "./Label";
export const contentFields = { title: { type: "text" } };
export default function Heading(props) {
  const { title } = props;
  return <Label>{title}</Label>;
}`,
      },
      {
        path: "src/components/Label.tsx",
        content: `export default function Label({ children }) {
  return <h2>{children}</h2>;
}`,
      },
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    expect(
      h2
        .closest("[data-storefront-field]")
        ?.getAttribute("data-storefront-field"),
    ).toBe("");
    expect(clicked(h2).fieldKey).toBeNull();
  });

  it("offers nothing for a component defined in Hero's own file", async () => {
    const root = await mount([
      {
        path: HERO,
        content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
function Heading({ title = "" }) {
  return <h2>{title}</h2>;
}
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  return <section><Heading title={subtitle} /><p>{title}</p></section>;
}`,
      },
      route(),
    ]);
    const h2 = only(root, "h2");
    expect(h2.textContent).toBe("Stored subtitle");
    expect(clicked(h2).fieldKey).toBeNull();
  });
  it("the same component keeps its field outside and refuses it inside a section", async () => {
    const root = await mount([
      hero(
        `      <Heading title={subtitle} />`,
        `import Heading from "./Heading";\n`,
      ),
      heading("title"),
      route(
        `<Heading title="Page heading" /><Hero {...hero} />`,
        `import Heading from "../components/Heading";`,
      ),
    ]);
    const [outside, inside] = Array.from(
      root.querySelectorAll<HTMLElement>("h2"),
    );
    expect(outside!.textContent).toBe("Page heading");
    expect(clicked(outside!).fieldKey).toBe("title");
    expect(inside!.textContent).toBe("Stored subtitle");
    expect(clicked(inside!).fieldKey).toBeNull();
  });
});

describe("what stays provable", () => {
  it.each([
    ["{title}", "Stored title"],
    ['{title ?? ""}', "Stored title"],
    ['{title || "x"}', "Stored title"],
  ])("%s names the title", async (expression, shown) => {
    const root = await mount([hero(`      <h1>${expression}</h1>`), route()]);
    const h1 = only(root, "h1");
    expect(h1.textContent).toBe(shown);
    expect(clicked(h1)).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("a component rendered outside any section keeps its own field", async () => {
    const root = await mount([
      hero(`      <h1>{title}</h1>`),
      heading("title"),
      route(
        `<Heading title="Page heading" /><Hero {...hero} />`,
        `import Heading from "../components/Heading";`,
      ),
    ]);
    const h2 = only(root, "h2");
    expect(h2.getAttribute("data-storefront-field")).toBe("title");
    expect(clicked(h2).fieldKey).toBe("title");
    expect(clicked(only(root, "h1"))).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("a platform link inside the section stays a forwarding element, not a nested component", async () => {
    // `morph/link` carries its markers to the anchor it renders by contract,
    // so it is marked like a host element; it takes no thread, and neither
    // its call site nor its own source gains a prop for one.
    const files = [
      hero(
        `      <ThemeLink link={{ href: "/sale" }}>{title}</ThemeLink>`,
        `import ThemeLink from "../morph/link";\n`,
      ),
      route(),
    ];
    const injected = injectPreviewBindings([
      ...livePreviewPlatformFiles(),
      ...files,
    ]).files;
    for (const path of [HERO, "src/morph/link.tsx"]) {
      expect(
        injected.find((file) => file.path === path)?.content,
      ).not.toContain("__morphRow");
    }
    const root = await mount(files);
    expect(clicked(only(root, "a"))).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("a section placed inside another section keeps its own fields", async () => {
    // Hero is handed to Frame to render, but it is a section of its own: its
    // call site is where its content comes from.
    const root = await mount(
      [
        hero(`      <h1>{title}</h1>`),
        {
          path: "src/components/Frame.tsx",
          content: `export const contentFields = { caption: { type: "text" } };
export default function Frame({ caption = "", children }) {
  return <div><p>{caption}</p>{children}</div>;
}`,
        },
        {
          path: ROUTE,
          content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
import Frame from "../components/Frame";
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { frame, hero } = Route.useLoaderData();
  return <main><Frame {...frame}><Hero {...hero} /></Frame></main>;
}`,
        },
      ],
      {
        version: 1,
        sections: [
          {
            id: "frame",
            type: "frame",
            enabled: true,
            props: { caption: "Stored caption" },
          },
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { title: "Stored title", subtitle: "S" },
          },
        ],
      } as unknown as StorefrontPageDocument,
    );
    expect(clicked(only(root, "p"))).toEqual({
      sectionId: "frame",
      fieldKey: "caption",
      fieldPath: "caption",
    });
    expect(clicked(only(root, "h1"))).toEqual({
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
    });
  });

  it("a list row handed over as heading={item.title} names the row's title (#198)", async () => {
    const root = await mount(
      [
        {
          path: "src/components/Card.tsx",
          content: `export const contentFields = { heading: { type: "text" } };
export default function Card({ heading = "" }) {
  return <article><h3>{heading}</h3></article>;
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
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import List from "../components/List";
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { list } = Route.useLoaderData();
  return <main><List {...list} /></main>;
}`,
        },
      ],
      {
        version: 1,
        sections: [
          {
            id: "list",
            type: "list",
            enabled: true,
            props: {
              items: [
                { id: "r1", title: "T1" },
                { id: "r2", title: "T2" },
              ],
            },
          },
        ],
      } as unknown as StorefrontPageDocument,
    );
    const second = Array.from(root.querySelectorAll<HTMLElement>("h3")).find(
      (element) => element.textContent === "T2",
    )!;
    expect(clicked(second)).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.1.title",
    });
  });
});
