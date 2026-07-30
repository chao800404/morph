import type { ProductOptionValueDTO } from "@/lib/product/dto/product-option.dto";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";

export const OPTION_VALUE_COLUMNS = [
  {
    key: "value",
    header: "Value",
    className: "font-medium",
    cell: (value) => value.value,
  },
] satisfies DataTableColumn<ProductOptionValueDTO>[];

