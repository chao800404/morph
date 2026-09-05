import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorMediaField } from "./editor-media-field";

vi.mock("@/components/asset/asset-library-picker", () => ({
  AssetLibraryPicker: ({
    onToggle,
    disabled,
  }: {
    onToggle: (asset: unknown) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-disabled={disabled ? "true" : "false"}
      onClick={() =>
        onToggle({
          id: "asset-1",
          name: "Hero image",
          url: "/assets/hero.webp",
          type: "image",
        })
      }
    >
      Pick Hero image
    </button>
  ),
}));

describe("EditorMediaField", () => {
  it("stores an external URL as a typed media value", () => {
    const onChange = vi.fn();
    render(
      <EditorMediaField
        label="Hero image"
        mediaType="image"
        value=""
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("https://example.com/image");
    fireEvent.change(input, {
      target: { value: "https://cdn.example.com/hero.webp" },
    });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith({
      source: "external",
      mediaType: "image",
      url: "https://cdn.example.com/hero.webp",
    });
  });

  it("stores the Asset identity and delivery URL", () => {
    const onChange = vi.fn();
    render(
      <EditorMediaField
        label="Hero image"
        mediaType="image"
        value={{
          source: "asset",
          mediaType: "image",
          assetId: "asset-old",
          url: "/assets/old.webp",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pick Hero image" }));

    expect(onChange).toHaveBeenCalledWith({
      source: "asset",
      mediaType: "image",
      assetId: "asset-1",
      url: "/assets/hero.webp",
      name: "Hero image",
    });
  });
});

describe("EditorMediaField failure states (MEDIA-03)", () => {
  // Clear used to always emit an `external` empty value, which a field
  // declared asset-only then rejected — the control offered an action its own
  // rules refused.
  // One canonical empty for every field. The asset-shaped empty this used to
  // send was rejected by the server for having no UUID, so an asset-only field
  // still could not be cleared.
  it("clears an asset-only field with the canonical empty value", () => {
    const onChange = vi.fn();
    render(
      <EditorMediaField
        label="Hero image"
        mediaType="image"
        allowExternal={false}
        value={{
          source: "asset",
          mediaType: "image",
          assetId: "asset-1",
          url: "/assets/hero.webp",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({
      source: "external",
      mediaType: "image",
      url: "",
    });
  });

  it("still clears to an external empty value when external is allowed", () => {
    const onChange = vi.fn();
    render(
      <EditorMediaField
        label="Hero image"
        mediaType="image"
        value={{
          source: "external",
          mediaType: "image",
          url: "https://cdn.example.com/a.png",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({
      source: "external",
      mediaType: "image",
      url: "",
    });
  });

  // The field looked inert and was not: the picker never received `disabled`.
  it("does not emit a change from a disabled asset picker", () => {
    const onChange = vi.fn();
    render(
      <EditorMediaField
        label="Hero image"
        mediaType="image"
        allowExternal={false}
        disabled
        value=""
        onChange={onChange}
      />,
    );

    const pick = screen.getByRole("button", { name: /pick hero image/i });
    expect(pick.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(pick);
    expect(onChange).not.toHaveBeenCalled();
  });
});
