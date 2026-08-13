import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createTableDetailPendingView,
  OrderDetailSkeleton,
  ProfileIndexSkeleton,
  SimpleDetailSkeleton,
  TaxRegionDetailSkeleton,
  TableDetailSkeleton,
} from "./collection-page-skeletons";

const ids = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[id$='-pending']")).map(
    (node) => node.id,
  );

describe("collection page skeletons", () => {
  it("keeps a simple detail page to its two stacked cards", () => {
    const { container } = render(<SimpleDetailSkeleton />);
    expect(ids(container)).toEqual([
      "detail-general-pending",
      "detail-metadata-pending",
    ]);
  });

  it("keeps a table detail page to its three stacked cards", () => {
    const { container } = render(<TableDetailSkeleton />);
    expect(ids(container)).toEqual([
      "detail-general-pending",
      "detail-table-pending",
      "detail-metadata-pending",
    ]);
  });

  it("can match detail pages with multiple table cards", () => {
    const MultiTablePendingView = createTableDetailPendingView(3);
    const { container } = render(<MultiTablePendingView />);

    expect(ids(container)).toEqual([
      "detail-general-pending",
      "detail-table-0-pending",
      "detail-table-1-pending",
      "detail-table-2-pending",
      "detail-metadata-pending",
    ]);
  });

  it("keeps the data-dependent tax sublevel slot explicit", () => {
    const { container } = render(<TaxRegionDetailSkeleton />);
    expect(ids(container)).toEqual([
      "tax-sublevel-state-pending",
      "tax-region-general-pending",
      "tax-default-rate-pending",
      "tax-overrides-pending",
      "tax-region-metadata-pending",
    ]);
  });

  it("keeps both order sidebar cards", () => {
    const { container } = render(<OrderDetailSkeleton />);
    expect(ids(container)).toEqual([
      "order-general-pending",
      "order-items-pending",
      "order-fulfillments-pending",
      "order-metadata-pending",
      "order-customer-pending",
      "order-addresses-pending",
    ]);
  });

  it("keeps all three profile cards", () => {
    const { container } = render(<ProfileIndexSkeleton />);
    expect(ids(container)).toEqual([
      "profile-information-pending",
      "profile-password-pending",
      "profile-sessions-pending",
    ]);
  });
});
