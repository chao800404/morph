/**
 * Selecting one entry of a repeated field offers that entry's whole row.
 *
 * An element inside a row carries a single field marker, so a navigation link
 * arrived at the Inspector as "label" and nothing else — while the row the
 * component declares also holds the destination the same anchor renders. The
 * marker says which element was clicked; the declaration says what the row
 * contains, and only the declaration can answer what is editable there.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

const navSource = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  navItems: {
    type: "array",
    label: "Navigation",
    fields: {
      label: { type: "text", label: "Label" },
      link: { type: "link", label: "Destination" },
    },
  },
} as const;

export default function Nav({ heading = "Menu", navItems = [] }) {
  return (
    <nav>
      {navItems.map((item, index) => (
        <a
          key={index}
          data-storefront-field="label"
          data-storefront-field-path={\`navItems.\${index}.label\`}
          href={item.link.href}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}`;

const themeFiles = [
  {
    path: "src/components/Nav.tsx",
    content: navSource,
    mimeType: "text/typescript",
  },
  {
    path: "src/routes/__root.tsx",
    content: `import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({ component: () => <Outlet /> });
`,
    mimeType: "text/typescript",
  },
] as never;

const rows = [
  { label: "Shop", link: { href: "/collections/all" } },
  { label: "About", link: { href: "/pages/about" } },
];

/** Selecting the anchor the second row renders. */
function rowSelection(): EditorSelectionDescriptor {
  return {
    sectionId: "section-1",
    kind: "link",
    componentType: "nav",
    tagName: "a",
    role: null,
    inputType: null,
    nodeId: null,
    sourceFilePath: "src/components/Nav.tsx",
    elementKey: null,
    fieldKey: "label",
    fieldPath: "navItems.1.label",
    className: "",
    isSection: false,
    computed: null,
    parentComputed: null,
    sectionComputed: null,
    inspectorOverride: null,
  } as EditorSelectionDescriptor;
}

function renderInspector(selection: EditorSelectionDescriptor) {
  const onPropsChange = vi.fn();
  render(
    <EditorStyleInspector
      view="content"
      section={
        {
          id: "section-1",
          type: "nav",
          componentRef: "nav.default",
          enabled: true,
          props: { heading: "Menu", navItems: rows },
        } as TestSection
      }
      themeFiles={themeFiles}
      selection={selection}
      onPropsChange={onPropsChange}
    />,
  );
  return { onPropsChange };
}

describe("selecting one entry of a repeated field", () => {
  it("offers the destination the row declares, not only the marked label", () => {
    renderInspector(rowSelection());

    expect(screen.getByText("Label")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getByLabelText("Link destination mode")).toBeTruthy();
  });

  it("writes the destination onto the selected row", () => {
    const { onPropsChange } = renderInspector(rowSelection());

    fireEvent.click(screen.getByText("External URL"));
    fireEvent.blur(screen.getByLabelText("Destination path or URL"), {
      target: { value: "/pages/contact" },
    });

    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navItems: [
          rows[0],
          expect.objectContaining({
            label: "About",
            link: expect.objectContaining({ href: "/pages/contact" }),
          }),
        ],
      }),
    );
  });

  it("shows the selected row rather than every sibling", () => {
    renderInspector(rowSelection());

    // The row's own label control carries the selected entry's value; the
    // sibling entry must not be offered beside it.
    const labelInputs = screen
      .getAllByDisplayValue(/Shop|About/)
      .map((input) => (input as HTMLInputElement).value);
    expect(labelInputs).toContain("About");
    expect(labelInputs).not.toContain("Shop");
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.queryByText("Add entry")).toBeNull();
  });

  it("still lists every entry when the component itself is selected", () => {
    renderInspector({
      ...rowSelection(),
      kind: "section",
      tagName: "nav",
      fieldKey: null,
      fieldPath: null,
      isSection: true,
    } as EditorSelectionDescriptor);

    expect(screen.getByDisplayValue("Shop")).toBeTruthy();
    expect(screen.getByDisplayValue("About")).toBeTruthy();
    expect(screen.getByText("Add entry")).toBeTruthy();
  });
});
