import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorCodeAssetsPanel } from "./editor-code-assets-panel";

const mocks = vi.hoisted(() => ({
  listItemsServerFn: vi.fn(),
  getMediaAsset: vi.fn(),
}));
vi.mock("@/server/asset/list-items.serverFn", () => ({
  listItemsServerFn: mocks.listItemsServerFn,
}));
vi.mock("@/server/asset/get-media-asset.serverFn", () => ({
  getMediaAsset: mocks.getMediaAsset,
}));

const ASSET_ID = "14e384d3-67ea-47e9-891c-23882d59554d";

beforeEach(() => {
  mocks.listItemsServerFn.mockReset();
  mocks.listItemsServerFn.mockResolvedValue({
    success: true,
    data: {
      currentFolder: null,
      folders: [],
      assets: [
        {
          id: ASSET_ID,
          name: "T21-1-1",
          url: `/assets/${ASSET_ID}.png`,
          thumbnailUrl: null,
        },
      ],
      pagination: { page: 1, limit: 12, totalAssets: 1, totalPages: 1 },
    },
  });
  mocks.getMediaAsset.mockReset();
  mocks.getMediaAsset.mockResolvedValue({
    success: true,
    message: "",
    data: {
      status: "found",
      asset: {
        id: ASSET_ID,
        type: "image",
        name: "T21-1-1",
        folders: ["T21"],
        mimeType: "image/png",
        size: 1_918_000,
        sizeFormatted: "1.83 MB",
        width: null,
        height: null,
      },
    },
  });
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorCodeAssetsPanel />
    </QueryClientProvider>,
  );
}

describe("EditorCodeAssetsPanel", () => {
  it("shows where a library asset lives when it is picked", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^T21-1-1/ }));

    const details = screen.getByRole("region", { name: "Asset details" });
    expect(await screen.findByText("T21 / T21-1-1")).toBeTruthy();
    expect(screen.getByText("1.83 MB · PNG")).toBeTruthy();
    expect(details.querySelector("img")?.getAttribute("src")).toBe(
      `/assets/${ASSET_ID}.png`,
    );
  });

  it("closes the details when the same asset is picked again", async () => {
    renderPanel();

    const tile = await screen.findByRole("button", { name: /^T21-1-1/ });
    fireEvent.click(tile);
    expect(screen.getByRole("region", { name: "Asset details" })).toBeTruthy();
    fireEvent.click(tile);
    expect(screen.queryByRole("region", { name: "Asset details" })).toBeNull();
  });

  it("browses videos on request", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    await waitFor(() =>
      expect(mocks.listItemsServerFn).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "video" }),
        }),
      ),
    );
  });

  it("offers no way to write an asset into Theme code", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^T21-1-1/ }));
    await screen.findByText("T21 / T21-1-1");

    expect(
      screen.queryByRole("button", { name: /insert|copy|use in code/i }),
    ).toBeNull();
    expect(
      screen.getByText(/choose it in a content field's Assets picker/i),
    ).toBeTruthy();
  });
});
