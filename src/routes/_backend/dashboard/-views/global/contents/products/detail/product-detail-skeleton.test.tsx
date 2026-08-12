import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductDetailSkeleton } from "./product-detail-skeleton";

/**
 * What matters about a pending view is its frame, not its prettiness.
 *
 * Streaming SSR sends the real page, then hydration re-suspends until the
 * view's chunk lands, so this fallback is spliced into an otherwise complete
 * layout. A card or a column missing here shows up as that region appearing,
 * vanishing and reappearing — which is why the counts are asserted rather than
 * left to the eye.
 */
const cardIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[id$='-skeleton']")).map(
    (node) => node.id,
  );

describe("ProductDetailSkeleton", () => {
  it("draws every card the loaded page has", () => {
    const { container } = render(<ProductDetailSkeleton />);

    // Document order, which `PageSplitLayout` decides: the main column is the
    // children and comes first, the sidebar follows. Four cards then three. If
    // a card is added to the detail page and not here, this test says so.
    expect(cardIds(container)).toEqual([
      "product-general-skeleton",
      "product-media-skeleton",
      "product-options-skeleton",
      "product-variants-skeleton",
      "product-organization-skeleton",
      "product-attributes-skeleton",
      "product-metadata-skeleton",
    ]);
  });

  it("keeps both columns, not just the main one", () => {
    const { container } = render(<ProductDetailSkeleton />);

    const sidebar = container.querySelector("#product-metadata-skeleton");
    const main = container.querySelector("#product-general-skeleton");

    expect(sidebar).not.toBeNull();
    expect(main).not.toBeNull();
    // Different parents means two real columns rather than one stacked list;
    // a single-column fallback is what makes the sidebar flicker.
    expect(sidebar?.parentElement).not.toBe(main?.parentElement);
  });

  it("gives the attributes card its seven rows", () => {
    // Height, width, length, weight, MID code, HS code, country of origin. The
    // sidebar's height is mostly this card, so a short guess makes the whole
    // column jump when the data lands.
    const { container } = render(<ProductDetailSkeleton />);

    const rows = container
      .querySelector("#product-attributes-skeleton")
      ?.querySelectorAll(".border-dashed");

    expect(rows).toHaveLength(7);
  });

  it("keeps every organization row represented while loading", () => {
    const { container } = render(<ProductDetailSkeleton />);

    const rows = container
      .querySelector("#product-organization-skeleton")
      ?.querySelectorAll(".border-dashed");

    // Tags, type, collection, categories, and sales channels.
    expect(rows).toHaveLength(5);
  });

  it("renders no text, so nothing can flash a wrong value", () => {
    // A placeholder that prints a real-looking label is worse than a grey
    // block: it reads as loaded content for the moment before it is replaced.
    const { container } = render(<ProductDetailSkeleton />);

    expect(container.textContent?.trim()).toBe("");
  });
});
