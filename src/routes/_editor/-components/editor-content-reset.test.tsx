import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorStyleInspector } from "./editor-style-inspector";

const SECTION = "src/components/page-sections/index/promo/index.tsx";

const file = (path: string, content: string) => ({
  id: path,
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path,
  content,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
});

const COMPONENT = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  note: { type: "text", label: "Note" },
  tagline: { type: "text", label: "Tagline" },
} as const;
export default function Promo({ heading = "Code heading", note, tagline = "Code tagline" }) {
  return <h2>{heading}{note}{tagline}</h2>;
}
`;

function renderInspector(
  props: Record<string, string>,
  onResetContentFields = vi.fn(async () => ({ success: true })),
) {
  render(
    <EditorStyleInspector
      view="content"
      section={{
        id: "promo",
        type: "promo",
        componentRef: SECTION,
        enabled: true,
        props,
      }}
      themeFiles={[file(SECTION, COMPONENT)] as never}
      onPropsChange={vi.fn()}
      onUpdateThemeFileStyle={vi.fn()}
      onJumpToCode={vi.fn()}
      onResetContentFields={onResetContentFields}
    />,
  );
  return onResetContentFields;
}

describe("Use code default", () => {
  it("removes this page's value and shows the component's default", async () => {
    const onReset = renderInspector({ heading: "Page heading" });
    expect(screen.getByDisplayValue("Page heading")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use code default" }));

    await waitFor(() =>
      expect(onReset).toHaveBeenCalledWith("promo", ["heading"]),
    );
    expect(await screen.findByDisplayValue("Code heading")).toBeTruthy();
    expect(screen.queryByDisplayValue("Page heading")).toBeNull();
  });

  // A promoted field has whatever name the author confirmed, so it is drawn by
  // the generic field list rather than one of the named blocks.
  it("is offered on a field under any name", async () => {
    const onReset = renderInspector({ tagline: "Page tagline" });
    fireEvent.click(screen.getByRole("button", { name: "Use code default" }));
    await waitFor(() =>
      expect(onReset).toHaveBeenCalledWith("promo", ["tagline"]),
    );
    expect(await screen.findByDisplayValue("Code tagline")).toBeTruthy();
  });

  it("is offered only where the page stores a value and the code has a default", () => {
    renderInspector({ note: "Stored note" });
    // `note` has no default in the source; `heading` stores nothing here.
    expect(
      screen.queryByRole("button", { name: "Use code default" }),
    ).toBeNull();
  });

  it("keeps the page's value when the reset is refused", async () => {
    renderInspector(
      { heading: "Page heading" },
      vi.fn(async () => ({ success: false, message: "Refused" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use code default" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Page heading")).toBeTruthy(),
    );
  });
});
