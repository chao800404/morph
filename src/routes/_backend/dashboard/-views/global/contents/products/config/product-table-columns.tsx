import { ImageSmBlock } from "@/components/asset/image-block";
import type { ProductListItemDTO } from "@/lib/product/dto/product.dto";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { ImageIcon } from "lucide-react";
import { ProductStatusBadge } from "../components/product-status-badge";

/**
 * Canonical product resource columns. Product lists embedded in another
 * resource detail must reuse this contract instead of creating a reduced,
 * visually different product table.
 */
export const PRODUCT_TABLE_COLUMNS = [
  {
    key: "thumbnail",
    header: "",
    label: "Thumbnail",
    fixed: true,
    className: "w-10 text-muted-foreground",
    cell: (product) => (
      <span className="flex w-6 items-center justify-center">
        {product.thumbnailUrl ? (
          <ImageSmBlock src={product.thumbnailUrl} alt={product.title} />
        ) : (
          <ImageIcon className="size-4" aria-hidden />
        )}
      </span>
    ),
  },
  {
    key: "title",
    header: "Product",
    className: "w-[24%] font-medium",
    cell: (product) => <div className="truncate">{product.title}</div>,
  },
  {
    key: "collection",
    header: "Collection",
    className: "w-[16%] text-muted-foreground",
    cell: (product) => (
      <div className="truncate">{product.collectionTitle ?? "—"}</div>
    ),
  },
  {
    key: "salesChannels",
    header: "Sales Channels",
    className: "w-[24%] text-muted-foreground",
    cell: (product) => (
      <div className="truncate">
        {product.salesChannels.length
          ? product.salesChannels.map((channel) => channel.name).join(", ")
          : "—"}
      </div>
    ),
  },
  {
    key: "variants",
    header: "Variants",
    className: "w-32 min-w-32 whitespace-nowrap text-muted-foreground",
    cell: (product) =>
      `${product.variantCount} ${product.variantCount === 1 ? "variant" : "variants"}`,
  },
  {
    key: "status",
    header: "Status",
    className: "w-32 min-w-32 whitespace-nowrap",
    cell: (product) => (
      <ProductStatusBadge status={product.status} variant="plain" />
    ),
  },
  {
    key: "updatedAt",
    header: "Updated",
    className: "w-36 min-w-36 whitespace-nowrap text-muted-foreground",
    cell: (product) => new Date(product.updatedAt).toLocaleDateString(),
  },
  {
    key: "handle",
    header: "Handle",
    defaultVisible: false,
    className: "w-44 min-w-44 text-muted-foreground",
    cell: (product) => <div className="truncate">/{product.handle}</div>,
  },
  {
    key: "createdAt",
    header: "Created",
    defaultVisible: false,
    className: "w-36 min-w-36 whitespace-nowrap text-muted-foreground",
    cell: (product) => new Date(product.createdAt).toLocaleDateString(),
  },
  {
    key: "type",
    header: "Type",
    defaultVisible: false,
    className: "w-40 min-w-40 text-muted-foreground",
    cell: (product) => (
      <div className="truncate">{product.typeValue ?? "—"}</div>
    ),
  },
  {
    key: "discountable",
    header: "Discountable",
    defaultVisible: false,
    className: "w-32 min-w-32 whitespace-nowrap text-muted-foreground",
    cell: (product) => (product.discountable ? "Yes" : "No"),
  },
  {
    key: "weight",
    header: "Weight",
    defaultVisible: false,
    className: "w-28 min-w-28 whitespace-nowrap text-muted-foreground",
    cell: (product) => product.weight ?? "—",
  },
  {
    key: "metadataKeys",
    header: "Metadata keys",
    defaultVisible: false,
    className: "w-32 min-w-32 whitespace-nowrap text-muted-foreground",
    cell: (product) => Object.keys(product.metadata).length,
  },
] satisfies DataTableColumn<ProductListItemDTO>[];
