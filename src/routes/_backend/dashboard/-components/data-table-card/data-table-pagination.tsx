import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useNavigate } from "@tanstack/react-router";
import { CardPagination } from "@/components/dashboard/card-pagination";
import type { DataTablePaginationInfo } from "./data-table-card";

/**
 * Footer pager for `DataTableCard`.
 *
 * The page number lives in the route's `page` search param so a given page is
 * shareable and the browser's back button steps through it, matching how the
 * assets list already works.
 */
export const DataTablePagination = ({
  pagination,
  scope,
}: {
  pagination?: DataTablePaginationInfo;
  scope?: "taxRate" | "orderItem" | "orderFulfillment";
}) => {
  const navigate = useNavigate();

  if (!pagination) return null;

  const handlePageChange = (action: "first" | "prev" | "next" | "last") => {
    const { page, totalPages } = pagination;
    const nextPage = {
      first: 1,
      prev: Math.max(1, page - 1),
      next: Math.min(totalPages, page + 1),
      last: totalPages,
    }[action];

    navigate({
      to: ".",
      search: (prev: DashboardSearch) => {
        if (scope === "taxRate") return { ...prev, taxRatePage: nextPage };
        if (scope === "orderItem") {
          return { ...prev, orderItemPage: nextPage };
        }
        if (scope === "orderFulfillment") {
          return { ...prev, orderFulfillmentPage: nextPage };
        }
        return { ...prev, page: nextPage };
      },
      replace: true,
    });
  };

  const startItem = (pagination.page - 1) * pagination.limit + 1;
  const endItem = Math.min(
    pagination.page * pagination.limit,
    pagination.total,
  );

  return (
    <div className="border-t px-6 py-4 text-sm">
      <CardPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        itemsLength={pagination.total}
        startItem={startItem}
        endItem={endItem}
        onPageChange={handlePageChange}
      />
    </div>
  );
};
