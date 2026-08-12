import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OrderDetailSkeleton,
  ProfileIndexSkeleton,
  SimpleDetailSkeleton,
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

  it("keeps both order sidebar cards", () => {
    const { container } = render(<OrderDetailSkeleton />);
    expect(ids(container)).toEqual([
      "detail-general-pending",
      "detail-table-pending",
      "detail-metadata-pending",
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
