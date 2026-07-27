import { Badge } from "@/components/ui/badge";
import type { ProductCategoryListItemDTO } from "@/lib/product/dto/product-taxonomy.dto";
import type {
  DataTableColumn,
  DataTableSortOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";

export const PRODUCT_CATEGORY_SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
] satisfies DataTableSortOption[];

export const PRODUCT_CATEGORY_COLUMNS = [
  {
    key: "name",
    header: "Name",
    className: "font-medium",
    // The full path rather than indentation: the list is flat and
    // server-paginated, so a subtree can straddle a page boundary and an indent
    // would imply a parent that is not on screen. Ancestors are muted so the
    // category's own name still reads as the row's subject.
    cell: (category) => (
      <span className="flex items-center gap-1 truncate">
        {category.ancestorNames.map((ancestor, index) => (
          <span
            key={`${category.id}-ancestor-${index}`}
            className="text-muted-foreground font-normal"
          >
            {ancestor} /
          </span>
        ))}
        <span className="truncate">{category.name}</span>
      </span>
    ),
  },
  {
    key: "handle",
    header: "Handle",
    className: "text-muted-foreground",
    cell: (category) => `/${category.handle}`,
  },
  {
    key: "status",
    header: "Status",
    className: "w-32",
    cell: (category) => (
      <Badge variant={category.isActive ? "default" : "secondary"}>
        {category.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    key: "visibility",
    header: "Visibility",
    className: "w-32",
    cell: (category) => (
      <Badge variant={category.isInternal ? "outline" : "secondary"}>
        {category.isInternal ? "Internal" : "Public"}
      </Badge>
    ),
  },
] satisfies DataTableColumn<ProductCategoryListItemDTO>[];
