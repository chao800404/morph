import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorStyleInspector } from "./editor-style-inspector";

/**
 * Inspector inputs made on an accepted copy newer than the one shown.
 *
 * A content write (W1) can be answered before the editor context renders its
 * answer. The shell compares an input made in that window with the newest
 * accepted copy (`acceptedContentProps`), so an input that puts a field back
 * to its value from before W1 is sent. The panel must keep showing that
 * input when W1's copy then renders: its rebase baseline for the field has to
 * move up to the accepted copy, as `handleFieldChange` does through
 * `noteLocalInput`. These are the other Inspector write paths.
 *
 * Each case: the panel renders the copy before W1 (O), the author makes W1
 * (E) and it is accepted, then, in the window, the author puts the field back
 * to O. The props are then re-rendered with W1's copy (E), as the context
 * would hand them. The panel must still show O.
 */

afterEach(() => cleanup());

const ENTRIES_PATH = "src/components/Entries.tsx";
const entriesFile = {
  id: "entries-source",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: ENTRIES_PATH,
  content: `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: {
    type: "array",
    label: "Entries",
    fields: { title: { type: "text", label: "Title" } },
  },
} as const;
export default function Entries({ heading, items = [] }: { heading?: string; items?: { id?: string; title?: string }[] }) {
  return <section><h2>{heading}</h2>{items.map((item, index) => <h3 key={item.id ?? index}>{item.title}</h3>)}</section>;
}`,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
};

type Props = Record<string, unknown>;

/** Renders the Inspector for `props`, with `accepted` as the newest accepted copy. */
function renderEntries(initial: Props) {
  const accepted: { current: Props } = { current: initial };
  const onPropsChange = vi.fn();
  const element = (props: Props) => (
    <EditorStyleInspector
      view="content"
      onPropsChange={onPropsChange}
      onUpdateThemeFileStyle={vi.fn()}
      onJumpToCode={vi.fn()}
      resourceKey="storefront-1:theme-1:template-1"
      rowIdTemplateId="template-1"
      section={{
        id: "section-1",
        type: "entries",
        componentRef: ENTRIES_PATH,
        enabled: true,
        props: props as never,
      }}
      themeFiles={[entriesFile]}
      acceptedContentProps={() => accepted.current}
    />
  );
  const view = render(element(initial));
  return {
    onPropsChange,
    accepted,
    /** The context renders `props` (a new object, as a read hands it). */
    rendersCopy: (props: Props) => view.rerender(element(structuredClone(props))),
  };
}

const removeButtons = () =>
  Array.from(document.querySelectorAll("button")).filter(
    (button) => button.textContent === "Remove",
  );

describe("Inspector write paths in the window after an answered write", () => {
  const ONE = { id: "row-one", title: "One" };
  const TWO = { id: "row-two", title: "Two" };

  it("a row removed back to the list before W1 stays removed when W1's copy renders", () => {
    const before = { items: [ONE] };
    const { onPropsChange, accepted, rendersCopy } = renderEntries(before);

    // W1: an entry is added, and the write is accepted.
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    expect(onPropsChange).toHaveBeenCalledTimes(1);
    const afterW1 = onPropsChange.mock.calls[0]![0] as { items: unknown[] };
    expect(afterW1.items).toHaveLength(2);
    accepted.current = afterW1;

    // In the window: the author removes it again.
    fireEvent.click(removeButtons()[1]!);
    expect(onPropsChange).toHaveBeenCalledTimes(2);
    expect(onPropsChange.mock.calls[1]![0]).toEqual(before);

    rendersCopy(afterW1);
    expect(removeButtons(), "W1's list rendered over the removal").toHaveLength(1);
    expect(screen.getByDisplayValue("One")).toBeTruthy();
  });

  it("a row field typed back to its value before W1 stays when W1's copy renders", () => {
    const before = { items: [ONE, TWO] };
    const { onPropsChange, accepted, rendersCopy } = renderEntries(before);

    const two = screen.getByDisplayValue("Two") as HTMLInputElement;
    fireEvent.input(two, { target: { value: "Two!" } });
    const afterW1 = onPropsChange.mock.lastCall![0] as Props;
    expect(afterW1).toEqual({ items: [ONE, { ...TWO, title: "Two!" }] });
    accepted.current = afterW1;

    fireEvent.input(screen.getByDisplayValue("Two!"), { target: { value: "Two" } });
    expect(onPropsChange.mock.lastCall![0]).toEqual(before);

    rendersCopy(afterW1);
    expect(screen.queryByDisplayValue("Two!"), "W1's row value rendered over the input").toBeNull();
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
  });

  it("control: another field changed by another writer in the window is still adopted, only the edited key is kept", () => {
    const before = { heading: "H0", items: [ONE, TWO] };
    const { onPropsChange, accepted, rendersCopy } = renderEntries(before);

    fireEvent.input(screen.getByDisplayValue("Two"), { target: { value: "Two!" } });
    const afterW1 = onPropsChange.mock.lastCall![0] as Props;
    expect(afterW1).toEqual({ heading: "H0", items: [ONE, { ...TWO, title: "Two!" }] });
    // Another writer changed the heading in the same accepted copy.
    const accepted2 = { ...afterW1, heading: "H1" };
    accepted.current = accepted2;

    fireEvent.input(screen.getByDisplayValue("Two!"), { target: { value: "Two" } });
    expect(onPropsChange.mock.lastCall![0]).toEqual(before);

    rendersCopy(accepted2);
    expect(screen.queryByDisplayValue("Two!"), "the edited key is kept").toBeNull();
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
    expect(screen.getByDisplayValue("H1"), "the other field's change is adopted").toBeTruthy();
    expect(screen.queryByDisplayValue("H0")).toBeNull();
  });
});

const GALLERY_PATH = "src/components/Gallery.tsx";
const gallerySource = `export const contentFields = {
  image: { type: "image", label: "Image" },
  imagePosition: { type: "text", label: "Position", maxLength: 100 },
};
export default function Gallery({ image, imagePosition = "center" }) {
  return <section><img src={image?.src} style={{ objectPosition: imagePosition }} /></section>;
}`;
const galleryFile = {
  id: "file-gallery",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: GALLERY_PATH,
  content: gallerySource,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
};
function imageLocation() {
  const lines = gallerySource.split("\n");
  const line = lines.findIndex((text) => text.includes("<img"));
  return `${GALLERY_PATH}:${line + 1}:${lines[line]!.indexOf("<img") + 1}`;
}

function renderGallery(initial: Props) {
  const accepted: { current: Props } = { current: initial };
  const onPropsChange = vi.fn();
  const element = (props: Props) => (
    <EditorStyleInspector
      view="styles"
      selectionSourceCurrent
      onPropsChange={onPropsChange}
      onUpdateThemeFileStyle={vi.fn()}
      section={{
        id: "gallery",
        type: "gallery",
        componentRef: GALLERY_PATH,
        enabled: true,
        props: props as never,
      }}
      themeFiles={[galleryFile]}
      acceptedContentProps={() => accepted.current}
      selection={
        {
          sectionId: "gallery",
          componentType: "gallery",
          kind: "image",
          sourceFilePath: GALLERY_PATH,
          sourceLocation: imageLocation(),
          elementKey: null,
          fieldKey: "image",
          field: "image",
          fieldPath: "image",
          itemId: null,
          descendantFields: [],
          tagName: "img",
          className: "object-cover",
          isSection: false,
        } as never
      }
    />
  );
  const view = render(element(initial));
  return {
    onPropsChange,
    accepted,
    rendersCopy: (props: Props) => view.rerender(element(structuredClone(props))),
  };
}

async function choosePosition(name: string) {
  const trigger = screen.getByRole("combobox", { name: "Object position" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
  await waitFor(() =>
    expect(screen.queryByRole("option", { name })).toBeNull(),
  );
}

describe("the object position control in the window after an answered write", () => {
  it("a position chosen back to its value before W1 stays when W1's copy renders", async () => {
    const before = { image: { src: "/one.png" }, imagePosition: "center" };
    const { onPropsChange, accepted, rendersCopy } = renderGallery(before);

    await choosePosition("Top");
    expect(onPropsChange).toHaveBeenCalledTimes(1);
    const afterW1 = onPropsChange.mock.calls[0]![0] as Props;
    expect(afterW1).toEqual({ ...before, imagePosition: "top" });
    accepted.current = afterW1;

    await choosePosition("Center");
    expect(onPropsChange).toHaveBeenCalledTimes(2);
    expect(onPropsChange.mock.calls[1]![0]).toEqual(before);

    rendersCopy(afterW1);
    const trigger = screen.getByRole("combobox", { name: "Object position" });
    expect(trigger.textContent, "W1's position rendered over the choice").toContain("Center");
  });
});
