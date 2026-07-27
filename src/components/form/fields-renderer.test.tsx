import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FieldsRenderer } from "./fields-renderer";

vi.mock("../folder-select/folder-select", () => ({
  FolderSelectField: () => null,
}));

describe("FieldsRenderer switch and tip fields", () => {
  it("emits a boolean from the shared switch field", () => {
    const onChange = vi.fn();

    render(
      <FieldsRenderer
        fields={[
          {
            type: "switch",
            name: "hasVariants",
            label: "Has variants",
            description: "Create more than one variant.",
            value: false,
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Has variants" }));

    expect(onChange).toHaveBeenCalledWith("hasVariants", true);
    const switchPanel = screen.getByRole("switch", {
      name: "Has variants",
    }).parentElement;
    expect(switchPanel?.className).toContain("dark:bg-zinc-700/30");
    expect(switchPanel?.className).not.toContain("bg-muted/20");
    expect(
      screen.getByText("Create more than one variant.").getAttribute("id"),
    ).toBe("field-hasVariants-description");
  });

  it("renders field-driven guidance through the shared Tip primitive", () => {
    render(
      <FieldsRenderer
        fields={[
          {
            type: "tip",
            name: "variant-tip",
            description: "Unchecked variants will not be created.",
          },
        ]}
      />,
    );

    const tip = screen.getByRole("note");
    expect(tip.textContent).toContain(
      "Unchecked variants will not be created.",
    );
    expect(tip.className).toContain("dark:bg-zinc-700/30");
    expect(tip.className).not.toContain("bg-muted/20");
  });
});

/**
 * A field's validation message lives on the field itself, so every form that
 * renders through `FieldsRenderer` reports errors the same way.
 */
describe("FieldsRenderer error", () => {
  it("marks the control invalid and points its description at the message", () => {
    render(
      <FieldsRenderer
        fields={[
          {
            type: "input",
            name: "title",
            label: "Title",
            error: "Title is required",
          },
        ]}
      />,
    );

    const input = screen.getByLabelText("Title");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("field-title-error");
    expect(screen.getByRole("alert").textContent).toBe("Title is required");
  });

  it("shows the hint instead when there is no error", () => {
    render(
      <FieldsRenderer
        fields={[
          {
            type: "input",
            name: "title",
            label: "Title",
            description: "Shown on the storefront",
          },
        ]}
      />,
    );

    const input = screen.getByLabelText("Title");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Shown on the storefront")).toBeDefined();
  });
});
