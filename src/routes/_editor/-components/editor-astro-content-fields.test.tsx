import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AstroInspectorField } from "@/lib/storefront/editor/astro-inspector-write";
import {
  EditorAstroContentFields,
  type EditorAstroContent,
} from "./editor-astro-content-fields";

// D3 rows 5-9: a declared field Design cannot prove writable for this call
// site (a literal override, a plain literal, a value through author code, a
// value the page passes itself) is shown as controlled by code, with no
// input, so nothing the author does on it writes. Its sibling stays
// editable (rule 02 section 5.3.1).
const selection = {};

function content(
  fields: readonly AstroInspectorField[],
  onChange = vi.fn(),
): EditorAstroContent {
  return {
    sectionId: "hero",
    resetKey: "home:hero:1",
    fields,
    values: () => ({ title: "SALE", desc: "SALE" }),
    shown: { generation: 4, selection },
    heldFields: () => new Set(),
    onChange,
    onBlur: vi.fn(),
    onOpenInCode: vi.fn(),
  };
}

describe("EditorAstroContentFields", () => {
  it("shows a field controlled by code as such, with no input, and its sibling edits", () => {
    const onChange = vi.fn();
    render(
      <EditorAstroContentFields
        content={content(
          [
            {
              key: "title",
              label: "Title",
              input: null,
              codeOnly: "controlled-by-code",
            },
            { key: "desc", label: "Desc", input: "text", codeOnly: null },
          ],
          onChange,
        )}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    const notice = document.querySelector(
      '[data-astro-field-code-controlled="title"]',
    );
    expect(notice?.textContent).toBe(
      "Title is controlled by code on this page. Edit it in Code mode.",
    );
    const desc = screen.getByRole("textbox", { name: "Desc" });
    expect((desc as HTMLInputElement).value).toBe("SALE");
    fireEvent.change(desc, { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("desc", "new", 4);
  });

  it("tells a type Design does not edit yet apart from a field the code controls", () => {
    render(
      <EditorAstroContentFields
        content={content([
          {
            key: "image",
            label: "Image",
            input: null,
            codeOnly: "unsupported-type",
          },
        ])}
      />,
    );
    expect(
      document.querySelector('[data-astro-field-code-controlled="image"]'),
    ).toBeNull();
    expect(screen.getByText("Image: edit this field in Code mode.")).toBeTruthy();
  });
});
