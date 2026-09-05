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

describe("AssetLibraryPicker failure states (MEDIA-03)", () => {
  const renderPicker = (props: Record<string, unknown> = {}) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <AssetLibraryPicker
          assetType="image"
          selectedIds={[]}
          onToggle={vi.fn()}
          {...props}
        />
      </QueryClientProvider>,
    );
  };

  // A failed request used to render the empty state, telling the author they
  // have no images — the one conclusion a failed request cannot support.
  it("reports a failed load instead of showing an empty library", async () => {
    mocks.listItemsServerFn.mockRejectedValue(new Error("network down"));
    renderPicker();

    await waitFor(() =>
      expect(screen.getByText(/could not load images/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/has no images yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("surfaces a rejected response's own message", async () => {
    mocks.listItemsServerFn.mockResolvedValue({
      success: false,
      message: "Not permitted",
    });
    renderPicker();

    await waitFor(() => expect(screen.getByText("Not permitted")).toBeTruthy());
  });

  it("retries on request", async () => {
    mocks.listItemsServerFn.mockRejectedValueOnce(new Error("network down"));
    mocks.listItemsServerFn.mockResolvedValue({
      success: true,
      data: {
        currentFolder: null,
        folders: [],
        assets: [],
        pagination: { page: 1, limit: 12, totalAssets: 0, totalPages: 1 },
      },
    });
    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    // Recovering shows the real empty state, which now means what it says.
    await waitFor(() =>
      expect(screen.getByText(/has no images yet/i)).toBeTruthy(),
    );
  });
});
