import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageSmBlock } from "./image-block";

describe("ImageSmBlock", () => {
  it("matches Medusa's centered 24 by 32 table thumbnail", () => {
    const { container } = render(
      <ImageSmBlock src="/product.png" alt="Product" />,
    );

    expect(container.firstElementChild?.className).toContain("w-6");
    expect(container.firstElementChild?.className).toContain("h-8");
    expect(container.firstElementChild?.className).toContain("rounded-[4px]");
    const image = screen.getByRole("img", { name: "Product" });
    expect(image.className).toContain("object-cover");
    expect(image.className).toContain("object-center");
  });

  it("shows a padded 150 by 150 contained image preview beside the thumbnail", async () => {
    const { container } = render(
      <ImageSmBlock src="/product.png" alt="Product" />,
    );

    fireEvent.focus(container.firstElementChild as HTMLElement);

    await waitFor(() => {
      const preview = document.querySelector('[data-slot="tooltip-content"]');
      expect(preview?.className).toContain("size-[150px]");
      expect(preview?.className).toContain("p-0.5");
      expect((preview as HTMLElement | null)?.style.boxShadow).toBe(
        "var(--table-image-preview-shadow)",
      );
      expect(preview?.getAttribute("data-side")).toBe("right");

      const previewImage = preview?.querySelector("img");
      expect(previewImage?.className).toContain("object-contain");
      expect(previewImage?.getAttribute("src")).toBe("/product.png");
    });
  });
});
