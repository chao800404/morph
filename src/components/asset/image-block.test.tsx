import { render, screen } from "@testing-library/react";
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
});
