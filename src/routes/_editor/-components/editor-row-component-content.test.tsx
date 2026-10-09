/**
 * Editing one row of a list whose rows are rendered by a component of their
 * own, from the click to the value the server accepts.
 *
 * Every step is the product's own: the Theme renders with real React after the
 * Live Preview's source pass, the click is resolved by the code the canvas
 * bridge runs, the selection reaches the Inspector in the shape the bridge
 * reports it, and what the Inspector writes is checked by the capability the
 * server resolves from the same saved files.
 *
 * The regression this guards: Card's `<h3>` named only `title`, so a click
 * resolved to a top-level `title` the List never declared — a field the
 * Inspector could not show and the server would refuse, or worse, a value
 * written where nothing reads it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  resolveSelectable,
  selectionKindOf,
  selectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { filterThemeContentProps } from "@/lib/storefront/theme-content-capabilities";
import { resolveThemeContentCapabilities } from "@/lib/storefront/theme-content-capability-resolver";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";
import { EditorStyleInspector } from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const files = [
  {
    path: "src/components/Card.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  body: { type: "textarea", label: "Body" },
};
export default function Card({ title = "", body = "" }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}`,
  },
  {
    path: "src/components/List.tsx",
    content: `import Card from "./Card";
export const contentFields = {
  label: { type: "text", label: "Label" },
  items: { type: "array", label: "Items", of: "./Card" },
};
export default function List({
  label = "L",
  items = [
    { id: "d1", title: "D1", body: "Default 1" },
    { id: "d2", title: "D2", body: "Default 2" },
  ],
}) {
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

const props = {
  label: "Why",
  items: [
    { id: "r1", title: "T1", body: "B1" },
    { id: "r2", title: "T2", body: "B2" },
  ],
};

/** What the bridge reports for a click on the element showing `text`. */
async function clickOn(
  text: string,
  stored = true,
): Promise<EditorSelectionDescriptor> {
  const { html } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), ...files],
    documents: stored
      ? {
          index: {
            version: 1,
            sections: [{ id: "list", type: "list", enabled: true, props }],
          },
        }
      : {},
  });
  const root = mountLivePreview(html);
  const element = [...root.querySelectorAll<HTMLElement>("*")].find(
    (candidate) =>
      candidate.children.length === 0 && candidate.textContent === text,
  )!;
  const item = resolveSelectable(element)!;
  const metadata = selectionMetadata(item);
  return {
    sectionId: item.sectionId!,
    kind: selectionKindOf(item),
    componentType: item.type,
    tagName: metadata.tagName,
    role: metadata.role,
    inputType: metadata.inputType,
    nodeId: item.element.dataset.morphNode ?? null,
    sourceFilePath: metadata.sourceFilePath,
    sourceLocation: item.sourceLocation ?? null,
    elementKey: item.elementKey,
    fieldKey: item.fieldKey,
    fieldPath: item.fieldPath,
    // As the shell copies them from the bridge's report.
    itemId: item.itemId,
    contentUnavailable: item.contentUnavailable,
    descendantFields: item.descendantFields,
    className: item.element.getAttribute("class") ?? "",
    isSection: item.element === item.section,
    computed: null,
    parentComputed: null,
    sectionComputed: null,
    inspectorOverride: null,
  };
}

function renderInspector(
  selection: EditorSelectionDescriptor,
  section: Partial<TestSection> = {},
) {
  const onPropsChange = vi.fn();
  const inspector = (patch: Partial<TestSection>) => (
    <EditorStyleInspector
      view="content"
      section={
        {
          id: "list",
          type: "list",
          componentRef: "src/components/List.tsx",
          enabled: true,
          props,
          ...patch,
        } as TestSection
      }
      themeFiles={
        files.map((file) => ({
          ...file,
          mimeType: "text/typescript",
        })) as never
      }
      selection={selection}
      onPropsChange={onPropsChange}
    />
  );
  const { rerender } = render(inspector(section));
  return {
    onPropsChange,
    /** The section's stored content changing under the open panel. */
    storedPropsBecome: (next: TestSection["props"]) =>
      rerender(inspector({ ...section, props: next })),
  };
}

/** The row editor's Title control for the selected row. */
function rowTitleInput(value = "T2"): HTMLElement {
  const inputs = screen
    .getAllByDisplayValue(value)
    .filter((element) => element.tagName === "INPUT");
  expect(inputs).toHaveLength(1);
  return inputs[0]!;
}

/** The capability the server validates a write against, from the same files. */
async function serverCapability() {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const { capabilities } = await resolveThemeContentCapabilities({
    manifestContent: null,
    readSource: async (path) => byPath.get(path) ?? null,
    additionalSourcePaths: ["src/components/List.tsx"],
  });
  return capabilities["src/components/List.tsx"]!;
}

describe("editing a row rendered by its own component", () => {
  it("selects the clicked row's field, as the bridge reports it", async () => {
    const selection = await clickOn("T2");
    expect({
      sectionId: selection.sectionId,
      fieldKey: selection.fieldKey,
      fieldPath: selection.fieldPath,
      sourceFilePath: selection.sourceFilePath,
    }).toEqual({
      sectionId: "list",
      fieldKey: "title",
      fieldPath: "items.1.title",
      sourceFilePath: "src/components/Card.tsx",
    });
  });

  it("writes the edit into that row, and the server accepts it", async () => {
    const { onPropsChange } = renderInspector(await clickOn("T2"));

    // The selected row is offered on its own, not beside its sibling.
    expect(screen.queryByDisplayValue("T1")).toBeNull();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.input(rowTitleInput(), { target: { value: "Edited" } });

    const written = onPropsChange.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(written).toEqual({
      label: "Why",
      items: [
        { id: "r1", title: "T1", body: "B1" },
        { id: "r2", title: "Edited", body: "B2" },
      ],
    });

    // The server's own validation of the same write: it resolves `of:` from
    // the saved files and refuses anything the List did not declare.
    expect(filterThemeContentProps(written, await serverCapability())).toEqual(
      written,
    );
  });

  it("writes into the row even when the section records no component", async () => {
    // The selection's source file is Card's, and Card declares `title` at its
    // own top level, so with no componentRef the Inspector may well read
    // Card's declaration. The write must still follow the selected path into
    // the row, never land on a top-level `title` the List never declared.
    const { onPropsChange } = renderInspector(await clickOn("T2"), {
      componentRef: undefined,
    });

    fireEvent.input(rowTitleInput(), { target: { value: "Edited" } });

    const written = onPropsChange.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(written).toEqual({
      label: "Why",
      items: [
        { id: "r1", title: "T1", body: "B1" },
        { id: "r2", title: "Edited", body: "B2" },
      ],
    });
  });

  it("offers the list's own rows before anything is stored", async () => {
    // Nothing stored: the canvas shows the List's default rows, and the click
    // lands in Card. Read from Card, the Inspector had "No entries yet"
    // beside a canvas showing two, and the field could not be edited.
    const { onPropsChange } = renderInspector(await clickOn("D2", false), {
      props: {},
    });

    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.input(rowTitleInput("D2"), { target: { value: "Edited" } });

    expect(onPropsChange.mock.calls.at(-1)?.[0]).toEqual({
      items: [
        { id: "d1", title: "D1", body: "Default 1" },
        { id: "d2", title: "Edited", body: "Default 2" },
      ],
    });
  });

  it("carries the clicked row's id, which outlives its index", async () => {
    expect((await clickOn("T2")).itemId).toBe("r2");
  });

  it("writes to the row selected even after the rows were reordered", async () => {
    // Selected as items.1 (r2). Before the edit is made, the rows swap — a
    // drag, an undo, another tab's save. Index 1 is now r1, which the author
    // never touched.
    const { onPropsChange, storedPropsBecome } = renderInspector(
      await clickOn("T2"),
    );
    storedPropsBecome({
      label: "Why",
      items: [
        { id: "r2", title: "T2", body: "B2" },
        { id: "r1", title: "T1", body: "B1" },
      ],
    });

    fireEvent.input(rowTitleInput(), { target: { value: "Edited" } });

    expect(onPropsChange.mock.calls.at(-1)?.[0]).toEqual({
      label: "Why",
      items: [
        { id: "r2", title: "Edited", body: "B2" },
        { id: "r1", title: "T1", body: "B1" },
      ],
    });
  });

  it("refuses to write when the selected row is gone, and says why", async () => {
    const { onPropsChange, storedPropsBecome } = renderInspector(
      await clickOn("T2"),
    );
    storedPropsBecome({
      label: "Why",
      items: [
        { id: "r1", title: "T1", body: "B1" },
        { id: "r3", title: "T3", body: "B3" },
      ],
    });

    // Nothing offered that could land on r1, r3 or a top-level `title`.
    expect(screen.queryByDisplayValue("T3")).toBeNull();
    expect(screen.queryByDisplayValue("T1")).toBeNull();
    expect(screen.queryByDisplayValue("T2")).toBeNull();
    expect(
      document.querySelector('[data-slot="inspector-content-unavailable"]')
        ?.textContent,
    ).toMatch(/moved or removed/);
    expect(onPropsChange).not.toHaveBeenCalled();
  });

  it("says why an element offers no content, and writes nothing for it", async () => {
    // As the bridge reports a Card behind `memo()`: its elements name
    // Card's own fields, which inside the row are not the List's.
    const { onPropsChange } = renderInspector({
      ...(await clickOn("T2")),
      fieldKey: null,
      fieldPath: null,
      contentUnavailable: "row-not-passed",
    });

    expect(
      document.querySelector('[data-slot="inspector-content-unavailable"]')
        ?.textContent,
    ).toMatch(/cannot yet link/);
    expect(screen.queryByDisplayValue("T2")).toBeNull();
    expect(onPropsChange).not.toHaveBeenCalled();
  });
});

/**
 * `__morphRow` tells the canvas which row an element is in. It authorises
 * nothing: an author is free to write a prop of that name, and what the server
 * stores is decided by the capability it resolves from the saved files, never
 * by the preview.
 */
describe("the row hint the preview carries", () => {
  it("never reaches the Document through an edit", async () => {
    const { onPropsChange } = renderInspector(await clickOn("T2"));
    fireEvent.input(rowTitleInput(), { target: { value: "Edited" } });
    expect(JSON.stringify(onPropsChange.mock.calls.at(-1)?.[0])).not.toContain(
      "__morphRow",
    );
  });

  it("is dropped by the server, with any field the List never declared", async () => {
    const sent = {
      label: "Why",
      title: "a top-level title the List never declared",
      __morphRow: { field: "items", path: "items.0", fields: {} },
      items: [
        {
          id: "r1",
          title: "T1",
          body: "B1",
          __morphRow: { field: "items", path: "items.0", fields: {} },
        },
      ],
    };
    expect(filterThemeContentProps(sent, await serverCapability())).toEqual({
      label: "Why",
      items: [{ id: "r1", title: "T1", body: "B1" }],
    });
  });
});
