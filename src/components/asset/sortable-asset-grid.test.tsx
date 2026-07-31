import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SelectedAsset } from "./asset-tile";
import { SortableAssetGrid } from "./sortable-asset-grid";

const ASSETS: SelectedAsset[] = [
  { id: "a1", name: "front", url: "/a1.png" },
  { id: "a2", name: "back", url: "/a2.png" },
];

describe("SortableAssetGrid", () => {
  it("makes every tile reachable and movable by keyboard", () => {
    // dnd-kit's keyboard plugin listens on the element, and a tile with no
    // click handler is a plain div — without this the gallery would be
    // pointer-only, and the gallery's order decides the thumbnail.
    const { container } = render(
      <SortableAssetGrid assets={ASSETS} onReorder={vi.fn()} />,
    );

    const tiles = container.querySelectorAll(
      '[aria-roledescription="Sortable image"]',
    );

    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.getAttribute("tabindex")).toBe("0");
      expect(tile.getAttribute("role")).toBe("button");
    }
  });

  it("still fires remove rather than starting a drag", () => {
    // The remove control sits inside the drag source; a missing activation
    // threshold turns its press into a drag and the button stops working.
    const onRemove = vi.fn();

    render(
      <SortableAssetGrid
        assets={ASSETS}
        onReorder={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove front" }));

    expect(onRemove).toHaveBeenCalledWith(ASSETS[0]);
  });

  it("marks only the first tile, which is the thumbnail", () => {
    render(
      <SortableAssetGrid
        assets={ASSETS}
        onReorder={vi.fn()}
        renderBadge={(_asset, index) =>
          index === 0 ? <span>Thumbnail</span> : null
        }
      />,
    );

    expect(screen.getAllByText("Thumbnail")).toHaveLength(1);
  });
});
