import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsCardHeader } from "./assets-card-header";

const navigate = vi.fn();
const openEdit = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
}));

vi.mock(
  "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions",
  () => ({
    useAssetRouteActions: () => ({ openEdit }),
  }),
);

vi.mock("@/server/asset/delete-items.serverFn", () => ({
  deleteItems: vi.fn(),
}));

describe("AssetsCardHeader", () => {
  beforeEach(() => {
    navigate.mockReset();
    openEdit.mockReset();
  });

  it("does not show folder actions at the root", () => {
    render(<AssetsCardHeader />);

    expect(
      screen.queryByRole("button", { name: /folder actions for/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("shows the current-folder actions before Create", () => {
    render(
      <AssetsCardHeader
        currentFolder={{
          id: "344d7b61-3615-4a95-a328-d38fdc4b88b2",
          name: "T21",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
          empty: false,
          parentId: null,
        }}
      />,
    );

    const actions = screen.getByRole("button", {
      name: "Folder actions for T21",
    });
    const create = screen.getByRole("button", { name: "Create" });

    expect(
      actions.compareDocumentPosition(create) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
