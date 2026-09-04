import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let searchState: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => searchState,
  useNavigate: () => navigate,
}));

vi.mock("@/server/table-view/table-views.serverFn", () => ({
  getTableViewConfiguration: vi.fn(async () => ({ success: true, data: null })),
  saveTableViewConfiguration: vi.fn(
    async ({ data }: { data: { configuration: unknown } }) => ({
      success: true,
      data: data.configuration,
    }),
  ),
}));

const listStorefrontReleaseHistory = vi.fn();
const activateStorefrontRelease = vi.fn();
const renameStorefrontRelease = vi.fn();

vi.mock("@/server/storefront/storefront-releases.serverFn", () => ({
  listStorefrontReleaseHistory: (args: unknown) =>
    listStorefrontReleaseHistory(args),
  activateStorefrontRelease: (args: unknown) => activateStorefrontRelease(args),
  renameStorefrontRelease: (args: unknown) => renameStorefrontRelease(args),
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

/** A full page of releases, so the list has more than one page to walk. */
function page(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    ...releases[0],
    id: `${prefix}${String(index).padStart(4, "0")}-1111-4111-8111-111111111111`,
    createdAt: `2026-08-${String(10 + (index % 18)).padStart(2, "0")}T10:00:00.000Z`,
  }));
}

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
    searchState = {};
    listStorefrontReleaseHistory.mockResolvedValue({
      success: true,
      data: {
        releases,
        pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
      },
    });
    renameStorefrontRelease.mockResolvedValue({
      success: true,
      data: releases[0],
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
    // The shared card owns this control, and it labels it "Retry".
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("asks the server for the page the URL names", async () => {
    // Releases only accumulate, so a fixed first page silently hides every
    // older one — including the version someone opened this panel to roll back
    // to. The page lives in the URL because the shared pager navigates to it.
    searchState = { releasePage: 3 };
    const older = page(2, "bbbb");
    listStorefrontReleaseHistory.mockResolvedValue({
      success: true,
      data: {
        releases: older,
        pagination: { page: 3, limit: 25, total: 60, totalPages: 3 },
      },
    });

    renderDialog(older[0].id);

    await waitFor(() =>
      expect(listStorefrontReleaseHistory).toHaveBeenCalledWith({
        data: { storefrontId: "store-1", limit: 25, page: 3 },
      }),
    );
    expect(await screen.findByText(older[1].id.slice(0, 8))).toBeTruthy();
  });

  it("reports how much history there is, not just what fits", async () => {
    listStorefrontReleaseHistory.mockResolvedValue({
      success: true,
      data: {
        releases: page(25, "aaaa"),
        pagination: { page: 1, limit: 25, total: 60, totalPages: 3 },
      },
    });

    renderDialog();

    // Without the total a full page is indistinguishable from the last one.
    expect(await screen.findByText(/of 60/)).toBeTruthy();
  });
  it("keeps Rename reachable on every row, not only the live one", async () => {
    // The card treats a custom actions cell as a replacement for its own menu,
    // so rendering just the Activate button silently removed Rename from every
    // row that had one — leaving it only where there was no button.
    renderDialog();

    await screen.findByText("Live");
    const menus = screen.getAllByRole("button", { name: /actions/i });
    expect(menus).toHaveLength(releases.length);
  });

  it("locks table layout and column widths to prevent rename layout shifts", async () => {
    renderDialog();

    await screen.findByText("Live");
    const table = screen.getByRole("table");
    expect(table.className).toContain("table-fixed");

    const descriptionHeader = screen.getByRole("columnheader", {
      name: /Description/i,
    });
    expect(descriptionHeader.className).toContain("w-[25%]");
  });

  it("optimistically updates description before server responds", async () => {
    let resolveRename: (value: unknown) => void;
    renameStorefrontRelease.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve;
        }),
    );

    renderDialog();
    await screen.findByText("Live");

    const menus = screen.getAllByRole("button", { name: /actions/i });
    fireEvent.pointerDown(menus[0], {
      button: 0,
      ctrlKey: false,
    });

    const renameOption = await screen.findByRole("menuitem", { name: /rename/i });
    fireEvent.click(renameOption);

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "v2.0.0-optimistic" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("v2.0.0-optimistic")).toBeTruthy();

    resolveRename!({ success: true, data: releases[0] });
  });
});
