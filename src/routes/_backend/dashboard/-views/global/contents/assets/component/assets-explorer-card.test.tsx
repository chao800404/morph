import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AssetsExplorerCard } from "./assets-explorer-card";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/dashboard/breadcrumb-collapse", () => ({
  BreadcrumbCollapse: () => null,
}));
vi.mock(
  "@/routes/_backend/dashboard/-components/assets-card/assets-card-header",
  () => ({ AssetsCardHeader: () => null }),
);
vi.mock(
  "@/routes/_backend/dashboard/-components/assets-card/assets-card-toolbar",
  () => ({ AssetsCardToolbar: () => null }),
);
vi.mock("@/server/asset/delete-items.serverFn", () => ({ deleteItems: vi.fn() }));
vi.mock("@/server/asset/move-items.serverFn", () => ({ moveItems: vi.fn() }));
vi.mock("@/lib/asset/download-utils", () => ({ downloadFolder: vi.fn() }));
vi.mock(
  "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions",
  () => ({ useAssetRouteActions: () => ({ openEdit: vi.fn() }) }),
);

const pagination = { page: 1, limit: 20, total: 0, totalPages: 0 };
const emptyRoot = { folders: [], assets: [], pagination } as never;

const sitePublic = () =>
  document.querySelector<HTMLAnchorElement>('[data-type="site-public-folder"]');

describe("AssetsExplorerCard: the site's public/ folder", () => {
  it("is pinned at the root of an empty library, opening Public, beside the upload prompt", () => {
    render(<AssetsExplorerCard label="Assets" data={emptyRoot} />);

    const folder = sitePublic();
    expect(folder?.getAttribute("href")).toBe("/dashboard/site-public");
    expect(folder?.textContent).toContain("public");
    expect(folder?.textContent).not.toContain("public/");
    expect(
      screen.getByRole("button", { name: "Create First Asset" }),
    ).toBeTruthy();
  });

  it("has no menu or selection, since it is never moved or deleted", () => {
    render(<AssetsExplorerCard label="Assets" data={emptyRoot} />);

    const folder = sitePublic()!;
    expect(folder.querySelector("button")).toBeNull();
    expect(folder.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("is not shown inside a library folder", () => {
    render(
      <AssetsExplorerCard
        label="Assets"
        data={
          {
            folders: [],
            assets: [],
            pagination,
            currentFolder: {
              id: "344d7b61-3615-4a95-a328-d38fdc4b88b2",
              name: "Photos",
              createdAt: "2026-08-12T00:00:00.000Z",
              updatedAt: "2026-08-12T00:00:00.000Z",
              parentId: null,
            },
          } as never
        }
      />,
    );

    expect(sitePublic()).toBeNull();
  });

  it("is not a search or filter result", () => {
    const { rerender } = render(
      <AssetsExplorerCard label="Assets" data={emptyRoot} query="hero" />,
    );
    expect(sitePublic()).toBeNull();
    expect(screen.getByText("No assets found")).toBeTruthy();

    rerender(
      <AssetsExplorerCard label="Assets" data={emptyRoot} hasActiveFilter />,
    );
    expect(sitePublic()).toBeNull();
  });
});
