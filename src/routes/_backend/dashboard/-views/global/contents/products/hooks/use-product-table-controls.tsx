import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableFilterDefinition } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  PRODUCT_DATE_FILTER,
  PRODUCT_STATUS_FILTER,
} from "../config/product-table.config";

type ProductFilterSearchKey =
  | "productStatus"
  | "productCreatedWithin"
  | "productUpdatedWithin";

/**
 * Shared URL-backed controls for every dashboard table that lists products.
 * A scoped table can add its own query constraint (for example salesChannelId)
 * while keeping the same filters and navigation behaviour as /dashboard/products.
 */
export const useProductTableControls = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();

  const setFilter = <TKey extends ProductFilterSearchKey>(
    key: TKey,
    value: DashboardSearch[TKey],
  ) => {
    void navigate({
      to: ".",
      search: (previous: DashboardSearch) => ({
        ...previous,
        [key]: value,
        page: undefined,
      }),
      replace: true,
    });
  };

  return {
    search,
    filters: [
      {
        key: "status",
        label: PRODUCT_STATUS_FILTER.label,
        options: [...PRODUCT_STATUS_FILTER.options],
        values: search.productStatus ? [search.productStatus] : [],
        multiple: false,
        onValuesChange: (values) =>
          setFilter(
            "productStatus",
            values.at(-1) as DashboardSearch["productStatus"],
          ),
      },
      {
        key: "created",
        label: "Created",
        options: [...PRODUCT_DATE_FILTER.options],
        values: search.productCreatedWithin
          ? [search.productCreatedWithin]
          : [],
        multiple: false,
        onValuesChange: (values) =>
          setFilter(
            "productCreatedWithin",
            values.at(-1) as DashboardSearch["productCreatedWithin"],
          ),
      },
      {
        key: "updated",
        label: "Updated",
        options: [...PRODUCT_DATE_FILTER.options],
        values: search.productUpdatedWithin
          ? [search.productUpdatedWithin]
          : [],
        multiple: false,
        onValuesChange: (values) =>
          setFilter(
            "productUpdatedWithin",
            values.at(-1) as DashboardSearch["productUpdatedWithin"],
          ),
      },
    ] satisfies DataTableFilterDefinition[],
  };
};
