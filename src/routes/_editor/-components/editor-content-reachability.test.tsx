/**
 * Every field a component declares must be reachable by selecting something.
 *
 * The three content regressions this guards against were all silent: the page
 * still rendered, nothing errored, and the field simply never appeared in the
 * Inspector. Each unit along the chain passed its own tests; what broke was the
 * seam between them — what the interpreter emits and what the editor can
 * resolve from it. This drives the real interpreter output through the real
 * preview resolution and asserts the two agree.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import { resolveThemeContentCapabilitiesFromFiles } from "@/lib/storefront/theme-content-capability-resolver";
import { deriveThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { createDefaultStorefrontHomeDocument } from "@/lib/storefront/default-storefront-document";
import { collectPreviewEditableNodes } from "@/lib/storefront/editor/preview-dom";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
  type LivePreviewDocuments,
} from "@/lib/test-utils/live-preview-render";

type File = { path: string; content: string };

const platform: File[] = [
  {
    path: "morph.theme.json",
    content: JSON.stringify({
      name: "Test",
      entry: "src/routes/index.tsx",
      router: { framework: "tanstack-start" },
      components: {},
      sections: {},
    }),
  },
  {
    path: "src/morph/content.ts",
    content: "export function content(){return {};}",
  },
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: RootComponent });
export function RootComponent() { return <div><Outlet /></div>; }`,
  },
];

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

/**
 * Field keys the editor can actually reach in the rendered page, keyed by the
 * section that owns them.
 */
function reachableFields(files: File[], document_: unknown) {
  const result = renderSafeThemeRoute({
    files,
    pathname: "/",
    document: document_,
  } as never);
  expect(result.diagnostics).toEqual([]);
  expect(result.success).toBe(true);
  const root = mount(renderToStaticMarkup(result.node as never));

  const reachable = new Map<string, Set<string>>();
  for (const node of collectPreviewEditableNodes(root)) {
    const key = node.target.fieldKey;
    if (!key) continue;
    const forSection = reachable.get(node.sectionId) ?? new Set<string>();
    forSection.add(key);
    reachable.set(node.sectionId, forSection);
  }
  return reachable;
}

/** What each rendered section's component declares as editable. */
function declaredFields(files: File[], routePath: string) {
  const { capabilities } = resolveThemeContentCapabilitiesFromFiles(files);
  const derived = deriveThemeRouteSections(files, routePath);
  expect(derived.diagnostics).toEqual([]);

  const declared = new Map<string, Set<string>>();
  for (const section of derived.sections) {
    const capability =
      capabilities[section.componentRef] ??
      capabilities[section.componentSourcePath];
    if (!capability) continue;
    declared.set(
      section.slotId,
      new Set(
        // An array field is reached through its rows, never as one control on
        // the element itself, so it is not expected among leaf field keys.
        Object.entries(capability.fields)
          .filter(([, definition]) => definition.type !== "array")
          .map(([key]) => key),
      ),
    );
  }
  return declared;
}

/**
 * Fields with no rendered content of their own.
 *
 * A link target and an image's alt text are real editable values but they are
 * not any element's content, so there is nothing on the canvas to click. They
 * are edited by selecting the section, which lists every declared field. Named
 * here rather than inferred, so that a field silently losing its element
 * binding still fails instead of being explained away.
 */
const SECTION_LEVEL_ONLY_FIELDS = new Set([
  // The destination of a button, now one `link` field carrying the address,
  // the target and the rel together. It replaced the `actionHref` and
  // `actionTarget` pair that used to sit here: where the link goes and whether
  // it opens a new tab are one decision, and neither renders any text.
  "action",
  "imageAlt",
]);

function expectEveryDeclaredFieldReachable(files: File[], document_: unknown) {
  const declared = declaredFields(files, "src/routes/index.tsx");
  const reachable = reachableFields(files, document_);

  // Asserted per section rather than as one set: which section a field belongs
  // to is half the contract, and a field reachable under the wrong section is
  // exactly the multi-instance failure this guards against.
  expect(declared.size).toBeGreaterThan(0);
  for (const [sectionId, keys] of declared) {
    const found = reachable.get(sectionId) ?? new Set<string>();
    const missing = [...keys].filter(
      (key) => !found.has(key) && !SECTION_LEVEL_ONLY_FIELDS.has(key),
    );
    expect({ sectionId, missing }).toEqual({ sectionId, missing: [] });
  }
}

const emptyDocument = { version: 1, sections: [] };

describe("declared content fields are reachable in the editor", () => {
  const promo: File = {
    path: "src/components/Promo.tsx",
    content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
};
export default function Promo({ heading = "Promo" }) {
  return <section><h2>{heading}</h2></section>;
}`,
  };

  it("reaches a component that has never been edited", () => {
    // The regression: a section with no stored values renders with `{}`, and
    // field inference validated against those runtime props. The binding a
    // component needs in order to be edited appeared only once it already had
    // been, so a new component was permanently uneditable.
    const files = [
      ...platform,
      promo,
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><Promo {...content("promo")} /></main>;
}`,
      },
    ];

    expectEveryDeclaredFieldReachable(files, emptyDocument);
  });

  it("reaches a component that carries no Morph markers at all", () => {
    // The regression: `data-storefront-field` was derived from an authored
    // `data-morph-element`. Removing the markers took every content binding
    // with it — 17 fields became 0 — with no error anywhere.
    const files = [
      ...platform,
      {
        path: "src/components/Hero.tsx",
        content: `export const contentFields = {
  eyebrow: { type: "text" },
  heading: { type: "text" },
  imageSrc: { type: "url" },
};
export default function Hero({
  eyebrow = "New",
  heading = "Title",
  imageSrc = "/a.png",
}) {
  return (
    <section>
      <p>{eyebrow}</p>
      <h1>{heading}</h1>
      <img src={imageSrc} alt="" />
    </section>
  );
}`,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><Hero {...content("hero")} /></main>;
}`,
      },
    ];

    expectEveryDeclaredFieldReachable(files, emptyDocument);
  });

  it("keeps two instances of one component separately reachable", () => {
    // The regression: both instances fell back to their shared source path, so
    // the editor could not tell them apart and would write to whichever came
    // first.
    const files = [
      ...platform,
      promo,
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return (
    <main>
      <Promo {...content("promo-a")} />
      <Promo {...content("promo-b")} />
    </main>
  );
}`,
      },
    ];

    const reachable = reachableFields(files, {
      version: 1,
      sections: [
        {
          id: "promo-a",
          type: "promo",
          enabled: true,
          props: { heading: "A" },
        },
        {
          id: "promo-b",
          type: "promo",
          enabled: true,
          props: { heading: "B" },
        },
      ],
    });

    expect([...reachable.keys()].sort()).toEqual(["promo-a", "promo-b"]);
    expect([...(reachable.get("promo-a") ?? [])]).toEqual(["heading"]);
    expect([...(reachable.get("promo-b") ?? [])]).toEqual(["heading"]);
  });

  it("reaches every row field of a repeated list declared by reference", () => {
    const files = [
      ...platform,
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = {
  title: { type: "text" },
  body: { type: "textarea" },
};
export default function Card({ title = "", body = "" }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}`,
      },
      {
        path: "src/components/List.tsx",
        content: `import Card from "./Card";
export const contentFields = {
  label: { type: "text" },
  items: { type: "array", of: "./Card" },
};
export default function List({ label = "L", items = [] }) {
  return (
    <section>
      <p>{label}</p>
      {items.map((item, index) => (
        <Card key={item.id ?? index} {...item} />
      ))}
    </section>
  );
}`,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import List from "../components/List";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><List {...content("list")} /></main>;
}`,
      },
    ];

    const reachable = reachableFields(files, {
      version: 1,
      sections: [
        {
          id: "list",
          type: "list",
          enabled: true,
          props: {
            label: "Why",
            items: [
              { id: "r1", title: "T1", body: "B1" },
              { id: "r2", title: "T2", body: "B2" },
            ],
          },
        },
      ],
    });

    expect([...(reachable.get("list") ?? [])].sort()).toEqual([
      "body",
      "items",
      "label",
      "title",
    ]);
  });
});

describe("the starter Theme every new store begins from", () => {
  it("leaves no declared field unreachable", () => {
    // This is what a customer receives. A field they can see in the source but
    // never reach in the editor is the same silent failure, shipped by default.
    const files = STARTER_THEME_FILES.map((file) => ({
      path: file.path,
      content: file.content,
    }));

    expectEveryDeclaredFieldReachable(
      files,
      createDefaultStorefrontHomeDocument(),
    );
  });
});

/**
 * The same contract, held by the real React Live Preview the canvas runs.
 *
 * Above, the interpreter produced the DOM; here the Theme's own modules do,
 * after the source pass the preview workspace runs, with content served
 * through the Theme's own `src/morph/content.ts`. The editor-side half,
 * `collectPreviewEditableNodes`, is the same code the canvas bridge runs.
 */
describe("declared content fields are reachable in the real React Live Preview", () => {
  const livePlatform: File[] = livePreviewPlatformFiles();

  async function liveReachableFields(
    files: File[],
    documents: LivePreviewDocuments,
    // Applied to the rendered markup before the editor reads it, so a test
    // can show the check notices a binding the compiler stopped emitting.
    tamper: (html: string) => string = (html) => html,
  ) {
    const { html, prepared } = await renderLivePreviewRoute({
      files,
      documents,
    });
    expect(prepared.bindings.skipped).toEqual([]);
    const root = mountLivePreview(tamper(html));
    const reachable = new Map<string, Set<string>>();
    for (const node of collectPreviewEditableNodes(root)) {
      const key = node.target.fieldKey;
      if (!key) continue;
      const forSection = reachable.get(node.sectionId) ?? new Set<string>();
      forSection.add(key);
      reachable.set(node.sectionId, forSection);
    }
    return reachable;
  }

  /** Declared fields the editor cannot reach, per section; empty when all are. */
  async function unreachableLiveFields(
    files: File[],
    documents: LivePreviewDocuments,
    tamper?: (html: string) => string,
  ) {
    const declared = declaredFields(files, "src/routes/index.tsx");
    const reachable = await liveReachableFields(files, documents, tamper);
    expect(declared.size).toBeGreaterThan(0);
    const unreachable: Record<string, string[]> = {};
    for (const [sectionId, keys] of declared) {
      const found = reachable.get(sectionId) ?? new Set<string>();
      const missing = [...keys].filter(
        (key) => !found.has(key) && !SECTION_LEVEL_ONLY_FIELDS.has(key),
      );
      if (missing.length) unreachable[sectionId] = missing;
    }
    return unreachable;
  }

  async function expectEveryDeclaredFieldLiveReachable(
    files: File[],
    documents: LivePreviewDocuments,
  ) {
    expect(await unreachableLiveFields(files, documents)).toEqual({});
  }

  const promo: File = {
    path: "src/components/Promo.tsx",
    content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
};
export default function Promo({ heading = "Promo" }) {
  return <section><h2>{heading}</h2></section>;
}`,
  };
  /**
   * A route rendering one Promo per slot, each on its own line as an author
   * (or a formatter) writes them. `separator: ""` writes them back to back.
   */
  const promoRoute = (
    slots: readonly string[],
    separator = "\n      ",
  ): File => ({
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return (
    <main>${separator}${slots.map((slot) => `<Promo {...content("${slot}")} />`).join(separator)}${separator}</main>
  );
}`,
  });
  const twoPromoDocuments: LivePreviewDocuments = {
    index: {
      version: 1,
      sections: [
        {
          id: "promo-a",
          type: "promo-a",
          enabled: true,
          props: { heading: "A" },
        },
        {
          id: "promo-b",
          type: "promo-b",
          enabled: true,
          props: { heading: "B" },
        },
      ],
    },
  };
  const section = (
    id: string,
    props: StorefrontPageDocument["sections"][number]["props"],
  ): StorefrontPageDocument["sections"][number] => ({
    id,
    type: id,
    enabled: true,
    props,
  });

  it("reaches a component that has never been edited", async () => {
    await expectEveryDeclaredFieldLiveReachable(
      [...livePlatform, promo, promoRoute(["promo"])],
      {},
    );
  });

  it("notices a field whose binding never reached the page", async () => {
    // The check has to be able to fail. With the compiler's field binding
    // stripped from the output, the same Theme must report `heading` missing.
    expect(
      await unreachableLiveFields(
        [...livePlatform, promo, promoRoute(["promo"])],
        {},
        (html) => html.replaceAll(' data-storefront-field="heading"', ""),
      ),
    ).toEqual({ promo: ["heading"] });
  });

  it("reaches a component that carries no Morph markers at all", async () => {
    await expectEveryDeclaredFieldLiveReachable(
      [
        ...livePlatform,
        {
          path: "src/components/Hero.tsx",
          content: `export const contentFields = {
  eyebrow: { type: "text" },
  heading: { type: "text" },
  imageSrc: { type: "url" },
};
export default function Hero({
  eyebrow = "New",
  heading = "Title",
  imageSrc = "/a.png",
}) {
  return (
    <section>
      <p>{eyebrow}</p>
      <h1>{heading}</h1>
      <img src={imageSrc} alt="" />
    </section>
  );
}`,
        },
        {
          path: "src/routes/index.tsx",
          content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><Hero {...content("hero")} /></main>;
}`,
        },
      ],
      {},
    );
  });

  /** Each instance reachable on its own, showing its own stored value. */
  async function expectTwoPromosApart(separator?: string) {
    const reachable = await liveReachableFields(
      [...livePlatform, promo, promoRoute(["promo-a", "promo-b"], separator)],
      twoPromoDocuments,
    );

    expect([...reachable.keys()].sort()).toEqual(["promo-a", "promo-b"]);
    expect([...(reachable.get("promo-a") ?? [])]).toEqual(["heading"]);
    expect([...(reachable.get("promo-b") ?? [])]).toEqual(["heading"]);
    const heading = (id: string) =>
      document.querySelector(`[data-storefront-section-id="${id}"] h2`)
        ?.textContent;
    expect([heading("promo-a"), heading("promo-b")]).toEqual(["A", "B"]);
  }

  it("keeps two instances of one component separately reachable", async () => {
    await expectTwoPromosApart();
  });

  // Written back to back (`<Promo/><Promo/>`), the first section's closing
  // wrapper and the second's opening one land on the same source offset.
  // `injectPreviewBindings` once spliced the opening tag first, which put the
  // second section inside the first (found while porting this file from the
  // interpreter); it now closes one wrapper before the next opens.
  it("keeps two instances apart when they are written back to back", async () => {
    await expectTwoPromosApart("");
  });

  // KNOWN DIVERGENCE from the interpreter, found while porting this file.
  // The interpreter carried the row through the component boundary and wrote
  // `items.0.title` on Card's own elements. The real preview wraps each row
  // (`data-storefront-field-path="items.0"`) but Card's fields are named only
  // `title`/`body`, so the editor drops them as ambiguous between rows and a
  // click resolves to a top-level `title` the List never declared.
  it.fails(
    "reaches every row field of a repeated list declared by reference",
    async () => {
      const reachable = await liveReachableFields(
        [
          ...livePlatform,
          {
            path: "src/components/Card.tsx",
            content: `export const contentFields = {
  title: { type: "text" },
  body: { type: "textarea" },
};
export default function Card({ title = "", body = "" }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}`,
          },
          {
            path: "src/components/List.tsx",
            content: `import Card from "./Card";
export const contentFields = {
  label: { type: "text" },
  items: { type: "array", of: "./Card" },
};
export default function List({ label = "L", items = [] }) {
  return (
    <section>
      <p>{label}</p>
      {items.map((item, index) => (
        <Card key={item.id ?? index} {...item} />
      ))}
    </section>
  );
}`,
          },
          {
            path: "src/routes/index.tsx",
            content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import List from "../components/List";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><List {...content("list")} /></main>;
}`,
          },
        ],
        {
          index: {
            version: 1,
            sections: [
              section("list", {
                label: "Why",
                items: [
                  { id: "r1", title: "T1", body: "B1" },
                  { id: "r2", title: "T2", body: "B2" },
                ],
              }),
            ],
          },
        },
      );

      expect([...(reachable.get("list") ?? [])].sort()).toEqual([
        "body",
        "items",
        "label",
        "title",
      ]);
    },
  );

  it("leaves no declared field of the starter Theme unreachable", async () => {
    await expectEveryDeclaredFieldLiveReachable(
      STARTER_THEME_FILES.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      { index: createDefaultStorefrontHomeDocument() },
    );
  });
});
