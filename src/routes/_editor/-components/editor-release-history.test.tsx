import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listStorefrontReleaseHistory = vi.fn();
const activateStorefrontRelease = vi.fn();

vi.mock("@/server/storefront/storefront-releases.serverFn", () => ({
  listStorefrontReleaseHistory: (args: unknown) =>
    listStorefrontReleaseHistory(args),
  activateStorefrontRelease: (args: unknown) => activateStorefrontRelease(args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}));

import { EditorReleaseHistoryDialog } from "./editor-release-history";

const releases = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-2",
    themeBuildId: "build-2",
    contentPublicationId: null,
    status: "available",
    metadata: null,
    createdBy: null,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    themeBuildId: "build-1",
    contentPublicationId: null,
    status: "available",
    metadata: null,
    createdBy: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  },
];

function renderDialog(activeReleaseId: string | null = releases[0].id) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorReleaseHistoryDialog
        open
        onOpenChange={vi.fn()}
        storefrontId="store-1"
        themeId="theme-1"
        activeReleaseId={activeReleaseId}
      />
    </QueryClientProvider>,
  );
}

describe("EditorReleaseHistoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStorefrontReleaseHistory.mockResolvedValue({
      success: true,
      data: releases,
    });
    activateStorefrontRelease.mockResolvedValue({
      success: true,
      data: releases[1],
    });
  });

  it("offers activation only for releases that are not already live", async () => {
    renderDialog();

    expect(await screen.findByText("Live")).toBeTruthy();
    const buttons = await screen.findAllByRole("button", { name: /Activate/ });
    expect(buttons).toHaveLength(1);
  });

  it("activates a release against the pointer the list was built from", async () => {
    renderDialog();
    const activateButton = await screen.findByRole("button", {
      name: /Activate/,
    });

    fireEvent.click(activateButton);

    await waitFor(() =>
      expect(activateStorefrontRelease).toHaveBeenCalledWith({
        data: {
          storefrontId: "store-1",
          releaseId: releases[1].id,
          // The compare-and-set is what makes a second person's activation lose
          // instead of silently overwriting the first.
          expectedActiveReleaseId: releases[0].id,
        },
      }),
    );
  });

  it("surfaces a rejected activation instead of reporting success", async () => {
    activateStorefrontRelease.mockResolvedValue({
      success: false,
      message: "Another release was activated. Refresh release history.",
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: /Activate/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Another release was activated. Refresh release history.",
      ),
    );
  });

  it("says so when the storefront has never been published", async () => {
    listStorefrontReleaseHistory.mockResolvedValue({ success: true, data: [] });
    renderDialog(null);

    expect(await screen.findByText(/No releases yet/)).toBeTruthy();
  });

  it("reports a failed load and offers a retry", async () => {
    listStorefrontReleaseHistory.mockResolvedValue({
      success: false,
      message: "Failed to fetch storefront release history",
    });
    renderDialog();

    expect(
      await screen.findByText("Failed to fetch storefront release history"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
