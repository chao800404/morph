/**
 * A list whose rows are rendered by a component of their own.
 *
 * `items: { type: "array", of: "./Card" }` with `<Card {...item} />` in the
 * map: Card's elements name `title`, a prop, and only the list's call site
 * knows that prop is `items.1.title`. The interpreter carried the row across
 * the boundary in its environment; the real React preview carries it as a
 * prop the compiler adds on both sides. These render the Theme with real
 * React after the preview's own source pass, and read the page with the same
 * resolution the canvas bridge runs — tree, click and selection restore.
 *
 * The other half of each case is the refusal. Where the call site does not
 * prove a prop is the row's, the element must offer no content field at all:
 * not the row's (the value on the page would not be what an edit writes), and
 * not a top-level one of the same name, which the list never declared.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  collectPreviewEditableNodes,
  resolvePreviewSelectionRestoreElement,
  resolveSelectable,
} from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
  type LivePreviewDocuments,
} from "@/lib/test-utils/live-preview-render";

type File = { path: string; content: string };

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not, and
  // selection restore builds its selectors with it.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const CARD: File = {
  path: "src/components/Card.tsx",
  content: `export const contentFields = {
  title: { type: "text" },
  body: { type: "textarea" },
};
export default function Card({ title = "", body = "" }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}`,
};

/** A List whose map renders `row` (JSX, with `item` and `index` in scope). */
function list(
  row: string,
  items = `{ type: "array", of: "./Card" }`,
  preamble = "",
): File {
  return {
    path: "src/components/List.tsx",
    content: `import Card from "./Card";
${preamble}
export const contentFields = {
  label: { type: "text" },
  items: ${items},
};
export default function List({ label = "L", items = [] }) {
  return (
    <section>
      <p>{label}</p>
      {items.map((item, index) => (
        ${row}
      ))}
    </section>
  );
}`,
  };
}

function route(body = `<List {...content("list")} />`): File {
  return {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import List from "../components/List";
import Card from "../components/Card";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main>${body}</main>;
}`,
  };
}

const section = (
  id: string,
  props: StorefrontPageDocument["sections"][number]["props"],
): StorefrontPageDocument["sections"][number] => ({
  id,
  type: id,
  enabled: true,
  props,
});

const twoRows: LivePreviewDocuments = {
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
};

async function mount(
  files: File[],
  documents: LivePreviewDocuments = twoRows,
): Promise<HTMLElement> {
  const { html, prepared } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), ...files],
    documents,
  });
  expect(prepared.bindings.skipped).toEqual([]);
  return mountLivePreview(html);
}

/**
 * Content each tree entry of a section edits, in document order: its path,
 * or for a top-level field its key, which is its path.
 */
function treeFieldPaths(root: HTMLElement, sectionId = "list") {
  return collectPreviewEditableNodes(root)
    .filter((node) => node.sectionId === sectionId)
    .map((node) => node.target.fieldPath ?? node.target.fieldKey)
    .filter(Boolean);
}

/** The element showing `text`, as a click on it would arrive. */
function elementShowing(root: HTMLElement, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.children.length === 0 && element.textContent === text,
  );
  if (!found) throw new Error(`nothing on the page shows ${text}`);
  return found;
}

function clicked(root: HTMLElement, text: string) {
  const item = resolveSelectable(elementShowing(root, text));
  return {
    sectionId: item?.sectionId,
    fieldKey: item?.fieldKey,
    fieldPath: item?.fieldPath,
  };
}

/** Why the element showing `text` offers no content, as the bridge reports. */
function reasonFor(root: HTMLElement, text: string) {
  return resolveSelectable(elementShowing(root, text))?.contentUnavailable;
}

describe("a row rendered by its own component, declared with of:", () => {
  it("lists each row and each of its fields under the row's own path", async () => {
    const root = await mount([
      CARD,
      list(`<Card key={item.id ?? index} {...item} />`),
      route(),
    ]);

    expect(treeFieldPaths(root)).toEqual([
      "label",
      "items.0",
      "items.0.title",
      "items.0.body",
      "items.1",
      "items.1.title",
      "items.1.body",
    ]);
    // The row is the element Card returns, not the preview's own wrapper.
    const row = collectPreviewEditableNodes(root).find(
      (node) => node.target.fieldPath === "items.1",
    );
    expect(row?.tagName).toBe("article");
  });

  it("resolves a click to the row's field, never a top-level one", async () => {
    const root = await mount([
      CARD,
      list(`<Card key={item.id ?? index} {...item} />`),
      route(),
    ]);

    expect(clicked(root, "T2")).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.1.title",
    });
    expect(clicked(root, "B1")).toEqual({
      sectionId: "list",
      fieldKey: "body",
      fieldPath: "items.0.body",
    });
    expect(clicked(root, "Why")).toEqual({
      sectionId: "list",
      fieldKey: "label",
      fieldPath: "label",
    });
  });

  it("restores a selection onto the same row after the page re-renders", async () => {
    const files = [
      CARD,
      list(`<Card key={item.id ?? index} {...item} />`),
      route(),
    ];
    const first = await mount(files);
    const selected = resolveSelectable(elementShowing(first, "T2"));
    expect(selected?.fieldPath).toBe("items.1.title");

    // A fresh render, as after a content edit: the old element is gone.
    const root = await mount(files);
    const listSection = root.querySelector<HTMLElement>(
      '[data-storefront-section-id="list"]',
    )!;
    const restored = resolvePreviewSelectionRestoreElement(listSection, {
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.1.title",
      isSection: false,
    });
    expect(restored.textContent).toBe("T2");

    // A row restores onto what Card returned, which has a box to outline;
    // the wrapper around it takes no space.
    const row = resolvePreviewSelectionRestoreElement(listSection, {
      sectionId: "list",
      fieldKey: "items",
      fieldPath: "items.0",
      isSection: false,
    });
    expect(row.tagName).toBe("ARTICLE");
  });

  it("keeps a restored selection on its row after the rows are reordered", async () => {
    const files = [
      CARD,
      list(`<Card key={item.id ?? index} {...item} />`),
      route(),
    ];
    const first = await mount(files);
    const selected = resolveSelectable(elementShowing(first, "T2"));
    expect([selected?.fieldPath, selected?.itemId]).toEqual([
      "items.1.title",
      "r2",
    ]);

    // The rows swap before the page re-renders. Index 1 is now r1's.
    const root = await mount(files, {
      index: {
        version: 1,
        sections: [
          section("list", {
            label: "Why",
            items: [
              { id: "r2", title: "T2", body: "B2" },
              { id: "r1", title: "T1", body: "B1" },
            ],
          }),
        ],
      },
    });
    const restored = resolvePreviewSelectionRestoreElement(
      root.querySelector<HTMLElement>('[data-storefront-section-id="list"]')!,
      {
        sectionId: "list",
        fieldKey: "title",
        fieldPath: "items.1.title",
        itemId: "r2",
        isSection: false,
      },
    );
    expect(restored.textContent).toBe("T2");
  });

  it("reports no row id where the row has none, or shares one", async () => {
    const files = [CARD, list(`<Card key={index} {...item} />`), route()];
    const withoutIds = await mount(files, {
      index: {
        version: 1,
        sections: [
          section("list", {
            items: [
              { title: "T1", body: "B1" },
              { title: "T2", body: "B2" },
            ],
          }),
        ],
      },
    });
    expect(resolveSelectable(elementShowing(withoutIds, "T2"))?.itemId).toBe(
      null,
    );

    const shared = await mount(files, {
      index: {
        version: 1,
        sections: [
          section("list", {
            items: [
              { id: "same", title: "T1", body: "B1" },
              { id: "same", title: "T2", body: "B2" },
            ],
          }),
        ],
      },
    });
    expect(resolveSelectable(elementShowing(shared, "T2"))?.itemId).toBe(null);
    // Unique again, it is reported.
    const unique = await mount(files);
    expect(resolveSelectable(elementShowing(unique, "T2"))?.itemId).toBe("r2");
  });

  it("reaches rows the Document has not stored yet", async () => {
    // Card is never told anything but its row: a single row with no stored
    // body still offers body, under that row.
    const root = await mount(
      [CARD, list(`<Card key={item.id ?? index} {...item} />`), route()],
      {
        index: {
          version: 1,
          sections: [section("list", { items: [{ id: "r1", title: "T1" }] })],
        },
      },
    );
    expect(treeFieldPaths(root)).toEqual([
      "label",
      "items.0",
      "items.0.title",
      "items.0.body",
    ]);
  });

  it("follows a row field the list hands over under another name", async () => {
    // `heading={item.title}`: the element Card calls heading shows, and edits,
    // the row's title.
    const root = await mount([
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = { heading: { type: "text" } };
export default function Card({ heading = "" }) {
  return <article><h3>{heading}</h3></article>;
}`,
      },
      list(
        `<Card key={item.id} heading={item.title} />`,
        `{ type: "array", fields: { title: { type: "text" }, body: { type: "textarea" } } }`,
      ),
      route(),
    ]);

    expect(clicked(root, "T2")).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.1.title",
    });
  });

  it("keeps Card's own fields when it is a section rather than a row", async () => {
    // The same component, placed on its own. Nothing is passed, so its
    // elements are its own fields exactly as before.
    const root = await mount(
      [
        CARD,
        list(`<Card key={item.id ?? index} {...item} />`),
        // Back to back, as an author may well write them: the two section
        // wrappers share an offset and must still close before they open.
        route(`<List {...content("list")} /><Card {...content("card")} />`),
      ],
      {
        index: {
          version: 1,
          sections: [
            ...twoRows.index!.sections,
            section("card", { title: "Solo", body: "Alone" }),
          ],
        },
      },
    );

    expect(clicked(root, "Solo")).toEqual({
      sectionId: "card",
      fieldKey: "title",
      fieldPath: "title",
    });
    expect(clicked(root, "T1")).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.0.title",
    });
  });
});

describe("a row component whose fields the call site does not prove", () => {
  /** What the editor offers for a row element and for the row's other fields. */
  async function offered(files: File[]) {
    const root = await mount(files);
    return { root, paths: treeFieldPaths(root) };
  }

  it("refuses a prop the list sets to something other than the row", async () => {
    // Card shows "fixed", whatever the row stores. An edit to items.0.title
    // would change nothing on the page.
    const { root, paths } = await offered([
      CARD,
      list(`<Card key={item.id} {...item} title="fixed" />`),
      route(),
    ]);
    expect(paths).toEqual([
      "label",
      "items.0",
      "items.0.body",
      "items.1",
      "items.1.body",
    ]);
    expect(clicked(root, "B2").fieldPath).toBe("items.1.body");
    const [first] = [...root.querySelectorAll<HTMLElement>("h3")];
    const item = resolveSelectable(first!);
    expect({ fieldKey: item?.fieldKey, fieldPath: item?.fieldPath }).toEqual({
      fieldKey: null,
      fieldPath: null,
    });
    expect(item?.contentUnavailable).toBe("value-not-from-row");
  });

  it("judges a prop by the value that ends up in effect, whichever way round", async () => {
    // `heading="fixed"` after the spread: the literal is what Card shows, so
    // heading is not the row's.
    const after = await offered([
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = { heading: { type: "text" }, body: { type: "textarea" } };
export default function Card({ heading = "", body = "" }) {
  return <article><h3>{heading}</h3><p>{body}</p></article>;
}`,
      },
      list(
        `<Card key={item.id} {...item} heading="fixed" />`,
        `{ type: "array", fields: { heading: { type: "text" }, body: { type: "textarea" } } }`,
      ),
      route(),
    ]);
    expect(after.paths).toEqual([
      "label",
      "items.0",
      "items.0.body",
      "items.1",
      "items.1.body",
    ]);
    expect(reasonFor(after.root, "fixed")).toBe("value-not-from-row");

    // The literal first, the spread after: the row's value wins only when the
    // row holds one, and the literal shows when it does not. Which of the two
    // is on the page depends on stored data, so the editor cannot confirm the
    // row is the source and does not write to it.
    const before = await offered([
      CARD,
      list(`<Card key={item.id} title="fixed" {...item} />`),
      route(),
    ]);
    expect(before.paths).toEqual([
      "label",
      "items.0",
      "items.0.body",
      "items.1",
      "items.1.body",
    ]);
    expect(reasonFor(before.root, "T1")).toBe("value-not-from-row");
  });

  it("refuses every prop when something else is spread onto the row", async () => {
    // `{...extra}` may set any prop, and which ones is only known at runtime.
    const { root, paths } = await offered([
      CARD,
      list(
        `<Card key={item.id} {...item} {...extra} />`,
        undefined,
        `const extra = { title: "x" };`,
      ),
      route(),
    ]);
    expect(paths).toEqual(["label", "items.0", "items.1"]);
    expect(clicked(root, "B1")).toEqual({
      sectionId: "list",
      fieldKey: null,
      fieldPath: null,
    });
    expect(reasonFor(root, "B1")).toBe("value-not-from-row");
  });

  it("does not yet reach the fields of a component that takes its props whole", async () => {
    // `function Card(props)` is ordinary React the editor does not support
    // yet: the row is handed over through the component's destructured props,
    // and this one has none to add it to. It previews as written; what it may
    // not do is guess a field.
    const { root, paths } = await offered([
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = {
  title: { type: "text" },
  body: { type: "textarea" },
};
export default function Card(props) {
  return <article><h3>{props.title}</h3><p>{props.body}</p></article>;
}`,
      },
      list(`<Card key={item.id} {...item} />`),
      route(),
    ]);
    expect(paths).toEqual(["label"]);
    // Card's elements carry no field of their own here, so the click lands
    // on the row around them — a path the List declares — and never on a
    // top-level `title`.
    expect(clicked(root, "T1")).toEqual({
      sectionId: "list",
      fieldKey: "items",
      fieldPath: "items.0",
    });
  });

  it("refuses the fields a component names as its own when it is not yet handed the row", async () => {
    // `memo()` is ordinary React the editor does not follow yet, so Card is
    // not handed the row — yet its elements are still marked with its own
    // declared `title` and `body`. Inside the List's row those are not the
    // List's: the editor must refuse them, and say why, not read a top-level
    // `title` the List never declared.
    const { root, paths } = await offered([
      {
        path: "src/components/Card.tsx",
        content: `import { memo } from "react";
export const contentFields = {
  title: { type: "text" },
  body: { type: "textarea" },
};
export default memo(function Card({ title = "", body = "" }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
});`,
      },
      list(`<Card key={item.id} {...item} />`),
      route(),
    ]);
    expect(
      root.querySelectorAll('[data-storefront-field="title"]').length,
    ).toBe(2);
    expect(paths).toEqual(["label"]);
    expect(clicked(root, "T2")).toEqual({
      sectionId: "list",
      fieldKey: null,
      fieldPath: null,
    });
    expect(reasonFor(root, "T2")).toBe("row-not-passed");
  });

  it("refuses a list Card keeps of its own inside the row", async () => {
    // A row holds no list. Card's own `tags.0.name` names Card's content,
    // and inside the List's row it is nothing the List declared.
    const { root, paths } = await offered([
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = {
  title: { type: "text" },
  tags: { type: "array", fields: { name: { type: "text" } } },
};
export default function Card({ title = "", tags = [{ id: "t", name: "Tag" }] }) {
  return (
    <article>
      <h3>{title}</h3>
      <ul>{tags.map((tag, i) => <li key={tag.id}><span>{tag.name}</span></li>)}</ul>
    </article>
  );
}`,
      },
      list(`<Card key={item.id} {...item} />`),
      route(),
    ]);
    expect(paths).toEqual([
      "label",
      "items.0",
      "items.0.title",
      "items.1",
      "items.1.title",
    ]);
    const tag = [...root.querySelectorAll<HTMLElement>("span")].find(
      (element) => element.textContent === "Tag",
    )!;
    const item = resolveSelectable(tag);
    expect({ fieldKey: item?.fieldKey, fieldPath: item?.fieldPath }).toEqual({
      fieldKey: null,
      fieldPath: null,
    });
    expect(item?.contentUnavailable).toBe("nested-list");
  });

  it("notices a row field whose path never reached the page", async () => {
    // The check has to be able to fail: with the row path stripped from
    // Card's elements, the same page must refuse them rather than fall back
    // to a top-level `title`.
    const { html } = await renderLivePreviewRoute({
      files: [
        ...livePreviewPlatformFiles(),
        CARD,
        list(`<Card key={item.id ?? index} {...item} />`),
        route(),
      ],
      documents: twoRows,
    });
    const root = mountLivePreview(
      html.replace(
        / data-storefront-field-path="items\.\d+\.(title|body)"/g,
        "",
      ),
    );
    expect(treeFieldPaths(root)).toEqual(["label", "items.0", "items.1"]);
    expect(clicked(root, "T2")).toEqual({
      sectionId: "list",
      fieldKey: null,
      fieldPath: null,
    });
  });

  it("keeps the row prop off a page element the component spreads its props onto", async () => {
    // The row goes into the component's own parameter, so a `...rest` it
    // passes to the DOM never carries it.
    const root = await mount([
      {
        path: "src/components/Card.tsx",
        content: `export const contentFields = { title: { type: "text" } };
export default function Card({ title = "", ...rest }) {
  return <article {...rest}><h3>{title}</h3></article>;
}`,
      },
      list(`<Card key={item.id} {...item} />`),
      route(),
    ]);
    expect(root.innerHTML).not.toMatch(/__morphrow/i);
    expect(clicked(root, "T1").fieldPath).toBe("items.0.title");
  });
});
