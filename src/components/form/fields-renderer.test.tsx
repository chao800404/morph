import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FieldsRenderer } from "./fields-renderer";

vi.mock("../folder-select/folder-select", () => ({
  FolderSelectField: () => null,
}));

// Both reach a server function, whose module graph ends at `cloudflare:workers`
// and cannot be loaded under jsdom. Neither field is what these tests assert on.
vi.mock("@/server/asset/create-items.serverFn", () => ({
  createItems: vi.fn(),
}));
vi.mock("./asset-library-panel", () => ({ AssetLibraryPanel: () => null }));
vi.mock("@queries/asset.queries", () => ({
  assetQueries: { all: () => ["assets"] },
}));

describe("FieldsRenderer switch and tip fields", () => {
  it("renders reusable choice cards and emits the selected value", () => {
    const onChange = vi.fn();
    render(<FieldsRenderer fields={[{ type: "choice-cards", name: "status", label: "Status", value: "draft", options: [{ label: "Draft", value: "draft", description: "Keep unavailable." }, { label: "Active", value: "active", description: "Publish now." }] }]} onChange={onChange} />);

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByRole("radiogroup").getAttribute("aria-labelledby")).toBe("field-status-label");
    expect(screen.getByRole("radio", { name: /Draft/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Active/ }));
    expect(onChange).toHaveBeenCalledWith("status", "active");
  });

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

describe("FieldsRenderer input affixes", () => {
  it("shows the prefix without putting it in the submitted value", () => {
    // The affix is decoration. If it ever became part of the input's value the
    // server would store "//winter-jacket" as the handle.
    render(
      <FieldsRenderer
        fields={[
          {
            type: "input",
            name: "handle",
            label: "Handle",
            prefix: "/",
            value: "winter-jacket",
          },
        ]}
      />,
    );

    const input = screen.getByLabelText("Handle") as HTMLInputElement;

    expect(input.value).toBe("winter-jacket");
    expect(screen.getByText("/")).toBeDefined();
  });

  it("still reports changes through the field name when affixed", () => {
    const onChange = vi.fn();

    render(
      <FieldsRenderer
        fields={[
          { type: "input", name: "handle", label: "Handle", prefix: "/" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Handle"), {
      target: { value: "summer" },
    });

    expect(onChange).toHaveBeenCalledWith("handle", "summer");
  });

  it("exposes the label hint to keyboard users", () => {
    render(
      <FieldsRenderer
        fields={[
          {
            type: "input",
            name: "handle",
            label: "Handle",
            labelHint: "Part of the storefront URL.",
          },
        ]}
      />,
    );

    // A focusable trigger, not a bare icon — otherwise the explanation is
    // reachable only with a mouse.
    expect(
      screen.getByRole("button", { name: "About Handle" }),
    ).toBeDefined();
  });
});
