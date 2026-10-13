import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorStyleInspector } from "./editor-style-inspector";

/**
 * The object position control's own refusals, at the boundary every Document
 * write from the Inspector crosses (`onPropsChange`). The shell-level cases,
 * with the real preview pass, are in `visual-editor-shell-round-trip.test.tsx`.
 */
const PATH = "src/components/Gallery.tsx";

function file(content: string) {
  return {
    id: "file-gallery",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    path: PATH,
    content,
    mimeType: "text/typescript",
    isEntry: false,
    version: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

function locationOf(source: string) {
  const lines = source.split("\n");
  const line = lines.findIndex((text) => text.includes("<img"));
  return `${PATH}:${line + 1}:${lines[line]!.indexOf("<img") + 1}`;
}

function renderInspector(args: {
  source: string;
  props: Record<string, unknown>;
  fieldPath: string;
  itemId?: string;
}) {
  const onPropsChange = vi.fn();
  render(
    <EditorStyleInspector
      view="styles"
      selectionSourceCurrent
      onPropsChange={onPropsChange}
      onUpdateThemeFileStyle={vi.fn()}
      section={{
        id: "gallery",
        type: "gallery",
        componentRef: PATH,
        enabled: true,
        props: args.props as never,
      }}
      themeFiles={[file(args.source)]}
      selection={
        {
          sectionId: "gallery",
          componentType: "gallery",
          kind: "image",
          sourceFilePath: PATH,
          sourceLocation: locationOf(args.source),
          elementKey: null,
          fieldKey: "image",
          field: "image",
          fieldPath: args.fieldPath,
          itemId: args.itemId ?? null,
          descendantFields: [],
          tagName: "img",
          className: "object-cover",
          isSection: false,
        } as never
      }
    />,
  );
  return onPropsChange;
}

async function openOptions() {
  const trigger = screen.getByRole("combobox", { name: "Object position" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return trigger;
}

const ROWS_SOURCE = `export const contentFields = {
  items: {
    type: "array",
    label: "Pictures",
    fields: {
      image: { type: "image", label: "Image" },
      imagePosition: { type: "text", label: "Position", maxLength: 100 },
    },
  },
};
export default function Gallery({ items = [{ id: "row-1", image: { src: "/default.png" } }] }) {
  return <div>{items.map((item, index) => (
    <img key={index} src={item.image?.src} style={{ objectPosition: item.imagePosition ?? "center" }} />
  ))}</div>;
}`;

describe("the object position control's refusals", () => {
  afterEach(() => cleanup());

  it("does not write a row the Document does not store yet", () => {
    // The canvas shows the component's own default row, id and all; writing
    // one field of it would store a list holding only that row.
    const onPropsChange = renderInspector({
      source: ROWS_SOURCE,
      props: {},
      fieldPath: "items.0.image",
      itemId: "row-1",
    });
    const trigger = screen.getByRole("combobox", { name: "Object position" });
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    expect(
      document.querySelector('[data-inspector-note="object-position"]')
        ?.textContent,
    ).toContain("Select the image again");
    expect(onPropsChange).not.toHaveBeenCalled();
  });

  it("writes a stored row's field", async () => {
    const onPropsChange = renderInspector({
      source: ROWS_SOURCE,
      props: { items: [{ id: "row-1", image: { src: "/one.png" } }] },
      fieldPath: "items.0.image",
      itemId: "row-1",
    });
    await openOptions();
    const option = screen.getByRole("option", { name: "Bottom" });
    fireEvent.keyDown(option, { key: "Enter" });
    fireEvent.click(option);
    expect(onPropsChange).toHaveBeenCalledTimes(1);
    expect(onPropsChange.mock.calls[0]![0].items[0].imagePosition).toBe(
      "bottom",
    );
    expect(onPropsChange.mock.calls[0]![1]).toMatchObject({
      inputFieldPath: "items.0.imagePosition",
      selectionFieldPath: "items.0.image",
    });
  });

  it("offers only the options a select field declares", async () => {
    const source = `export const contentFields = {
  image: { type: "image", label: "Image" },
  imagePosition: {
    type: "select",
    label: "Position",
    options: [
      { label: "Top", value: "top" },
      { label: "Center", value: "center" },
    ],
  },
};
export default function Gallery({ image, imagePosition = "center" }) {
  return <section><img src={image?.src} style={{ objectPosition: imagePosition }} /></section>;
}`;
    renderInspector({
      source,
      props: { image: { src: "/one.png" }, imagePosition: "center" },
      fieldPath: "image",
    });
    await openOptions();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Center", "Top"]);
  });

  it("is unavailable when the selection is older than the source", () => {
    const onPropsChange = vi.fn();
    render(
      <EditorStyleInspector
        view="styles"
        selectionSourceCurrent={false}
        onPropsChange={onPropsChange}
        onUpdateThemeFileStyle={vi.fn()}
        section={{
          id: "gallery",
          type: "gallery",
          componentRef: PATH,
          enabled: true,
          props: { items: [{ id: "row-1", image: { src: "/one.png" } }] },
        }}
        themeFiles={[file(ROWS_SOURCE)]}
        selection={
          {
            sectionId: "gallery",
            componentType: "gallery",
            kind: "image",
            sourceFilePath: PATH,
            sourceLocation: locationOf(ROWS_SOURCE),
            elementKey: null,
            fieldKey: "image",
            field: "image",
            fieldPath: "items.0.image",
            itemId: "row-1",
            descendantFields: [],
            tagName: "img",
            className: "",
            isSection: false,
          } as never
        }
      />,
    );
    expect(
      screen
        .getByRole("combobox", { name: "Object position" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    expect(
      document.querySelector('[data-inspector-note="object-position"]')
        ?.textContent,
    ).toContain("The source changed since this image was selected");
    expect(onPropsChange).not.toHaveBeenCalled();
  });
});
