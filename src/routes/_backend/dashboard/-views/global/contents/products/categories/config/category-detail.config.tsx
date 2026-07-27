import { Badge } from "@/components/ui/badge";
import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";

const STATUS_VARIANT = {
  published: "default",
  draft: "secondary",
  archived: "outline",
} as const;

/**
 * The products filed under a category.
 *
 * Sales channels are omitted from Medusa's set because that module does not
 * exist here yet — an empty column would imply the data is missing rather than
 * the feature.
 */
export const CATEGORY_PRODUCT_COLUMNS = [
  {
    key: "title",
    header: "Product",
    className: "font-medium",
    cell: (product) => product.title,
  },
  {
    key: "handle",
    header: "Handle",
    className: "text-muted-foreground",
    cell: (product) => `/${product.handle}`,
  },
  {
    key: "status",
    header: "Status",
    className: "w-32",
    cell: (product) => (
      <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
    ),
  },
] satisfies DataTableColumn<ProductDTO>[];
