import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AssetLibraryPicker } from "./asset-library-picker";

const mocks = vi.hoisted(() => ({ listItemsServerFn: vi.fn() }));

vi.mock("@/server/asset/list-items.serverFn", () => ({
  listItemsServerFn: mocks.listItemsServerFn,
}));

describe("AssetLibraryPicker", () => {
  it("requests the declared media type and returns the selected asset", async () => {
    mocks.listItemsServerFn.mockResolvedValue({
      success: true,
      data: {
        currentFolder: null,
        folders: [],
        assets: [
          {
            id: "6550fe95-9fb0-4008-b837-962da1b449d7",
            name: "Launch film",
            url: "/assets/launch.mp4",
            thumbnailUrl: "/assets/launch.webp",
          },
        ],
        pagination: { page: 1, limit: 12, totalAssets: 1, totalPages: 1 },
      },
    });
    const onToggle = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AssetLibraryPicker
          assetType="video"
          selectedIds={[]}
          onToggle={onToggle}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.listItemsServerFn).toHaveBeenCalled());
    expect(mocks.listItemsServerFn.mock.calls[0]?.[0]).toMatchObject({
      data: { type: "video" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Launch film" }));
    expect(onToggle).toHaveBeenCalledWith({
      id: "6550fe95-9fb0-4008-b837-962da1b449d7",
      name: "Launch film",
      url: "/assets/launch.mp4",
      type: "video",
      thumbnailUrl: "/assets/launch.webp",
    });
  });
});
