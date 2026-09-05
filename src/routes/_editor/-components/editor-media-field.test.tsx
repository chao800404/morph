import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorMediaField } from "./editor-media-field";

vi.mock("@/components/asset/asset-library-picker", () => ({
  AssetLibraryPicker: ({ onToggle }: { onToggle: (asset: unknown) => void }) => (
    <button
      type="button"
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
