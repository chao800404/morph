import type { ProductStatus } from "@/lib/product/dto/product.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type {
  DataTableFilterOption,
  DataTableSortOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";

export const PRODUCT_STATUS_FILTER = {
  label: "Status",
  options: [
    { value: "draft", label: "Draft" },
    { value: "published", label: "Published" },
    { value: "archived", label: "Archived" },
  ] satisfies DataTableFilterOption<ProductStatus>[],
} as const;

export const PRODUCT_DATE_FILTER = {
  options: [
    { value: "24h", label: "Last 24 hours" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ] satisfies DataTableFilterOption<
    NonNullable<DashboardSearch["productCreatedWithin"]>
  >[],
} as const;

export const PRODUCT_SORT_OPTIONS = [
  { value: "name", label: "Title" },
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
] satisfies DataTableSortOption[];
