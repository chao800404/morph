import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { AssetsSelectContent } from "./assets-select-content";

const resetStore = () =>
  useAssetsStore.setState({
    selectedItems: new Map(),
    assetsData: {},
  });

afterEach(resetStore);

describe("AssetsSelectContent", () => {
  it("keeps a selected image visible when it is no longer in the current page data", () => {
    useAssetsStore.setState({
      assetsData: {},
      selectedItems: new Map([
        [
          "asset-image-1",
          {
            type: "asset",
            id: "image-1",
            name: "Product image",
            fileType: "image",
            extension: "png",
            src: "/assets/image-1.png",
            alt: "Product image preview",
          },
        ],
      ]),
    });

    render(<AssetsSelectContent />);

    const preview = screen.getByRole("img", {
      name: "Product image preview",
    });
    expect(preview.getAttribute("src")).toBe("/assets/image-1.png");
    expect(screen.getByRole("button", { name: "Remove image" })).not.toBeNull();
    expect(screen.queryByText("png")).toBeNull();
  });
});
