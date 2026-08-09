import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetCardCaption } from "./asset-card-caption";

describe("AssetCardCaption", () => {
  it("truncates the name without allowing the category badge to shrink", () => {
    render(
      <AssetCardCaption
        name="A very long asset name that needs truncation"
        category="png"
      />,
    );

    expect(screen.getByText(/A very long asset/).className).toContain("truncate");
    expect(screen.getByText("png").className).toContain("shrink-0");
  });

  it("renders a standalone badge without the caption container when only a category is provided", () => {
    const { container, getByText } = render(
      <AssetCardCaption category="png" />,
    );

    expect(getByText("png").className).toContain("absolute");
    expect(getByText("png").className).toContain("bottom-2");
    expect(getByText("png").className).toContain("right-2");
    expect(getByText("png").className).toContain("bg-blue-600");
    expect(getByText("png").className).toContain("text-white");
    expect(container.querySelector("p")).toBeNull();
  });
});
