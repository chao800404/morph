import { describe, expect, it } from "vitest";
import { selectDashboardProductCards } from "./dashboard-home.config";

describe("selectDashboardProductCards", () => {
  it("prefers recent products with thumbnails before using empty fallbacks", () => {
    const products = [
      { id: "empty-newest", thumbnailUrl: null },
      { id: "image-one", thumbnailUrl: "/one.png" },
      { id: "image-two", thumbnailUrl: "/two.png" },
      { id: "image-three", thumbnailUrl: "/three.png" },
    ];

    expect(selectDashboardProductCards(products).map(({ id }) => id)).toEqual([
      "image-one",
      "image-two",
      "image-three",
    ]);
  });

  it("keeps image-less products as fallbacks when fewer than three have images", () => {
    const products = [
      { id: "empty-one", thumbnailUrl: null },
      { id: "image-one", thumbnailUrl: "/one.png" },
      { id: "empty-two", thumbnailUrl: null },
    ];

    expect(selectDashboardProductCards(products).map(({ id }) => id)).toEqual([
      "image-one",
      "empty-one",
      "empty-two",
    ]);
  });
});
