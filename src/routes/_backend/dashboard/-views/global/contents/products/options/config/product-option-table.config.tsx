import { StatusBadge } from "@/components/ui/status-badge";
import type { ProductOptionCreatedWithin } from "@/lib/product/config/product-option-list";
import type { ProductOptionDTO } from "@/lib/product/dto/product-option.dto";
import type {
  DataTableColumn,
  DataTableFilterOption,
  DataTableSortOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";

export const PRODUCT_OPTION_CREATED_FILTER = {
  label: "Created",
  options: [
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ] satisfies DataTableFilterOption<ProductOptionCreatedWithin>[],
} as const;

export const PRODUCT_OPTION_SORT_OPTIONS = [
  { value: "name", label: "Title" },
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
] satisfies DataTableSortOption[];

export const PRODUCT_OPTION_COLUMNS = [
  {
    key: "title",
    header: "Title",
    className: "w-64 font-medium",
    cell: (option) => option.title,
  },
  {
    key: "values",
    header: "Values",
    cell: (option) =>
      `${option.values.length} value${option.values.length === 1 ? "" : "s"}`,
  },
  {
    key: "status",
    header: "Status",
    className: "w-32",
    // Entries in this library are global; product-exclusive options are
    // authored and managed on the product itself.
    cell: () => (
      <StatusBadge variant="plain" color="blue">
        Global
      </StatusBadge>
    ),
  },
] satisfies DataTableColumn<ProductOptionDTO>[];
