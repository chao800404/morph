import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import {
  filterVariants,
  optionSortKey,
  paginateVariants,
  sortVariants,
  toVariantSortKey,
  variantOptionValue,
  VARIANT_PAGE_SIZE,
} from "@/lib/product/variant-table";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
  type DataTableSortOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { productQueries } from "@queries/product.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ImageIcon, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteVariantsAction } from "../product-actions";

/**
 * The variant matrix, as a list.
 *
 * Same shape as Medusa's: a thumbnail cell, the identifying columns, one column
 * per option axis, inventory, and a row menu. Editing is a route rather than
 * inline fields — a variant carries prices per currency, and a row wide enough
 * for those stops being readable.
 *
 * Paged in the browser, not by the server: `findDetail` already returns every
 * variant with the product, so a request per page would re-fetch data that is
 * in hand. The page still lives in `?page` so it survives a refresh.
 */
const inventoryLabel = (variant: ProductVariantDTO): string => {
  if (!variant.manageInventory) return "Not tracked";
  // Medusa says "at 1 location" here; stock locations are not modelled in this
  // catalogue, and naming one would imply a feature that does not exist.
  return `${variant.inventoryQuantity} available`;
};

export const ProductVariantsCard = ({
  product,
}: {
  product: ProductDetailDTO;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as DashboardSearch;

  const columns = useMemo<DataTableColumn<ProductVariantDTO>[]>(
    () => [
      {
        key: "thumbnail",
        header: "",
        className: "w-10 text-muted-foreground",
        // Variant-level images are a separate link table that this page does
        // not load yet, so every row shows the placeholder.
        cell: () => <ImageIcon className="size-4" aria-hidden />,
      },
      {
        key: "title",
        header: "Title",
        className: "font-medium",
        cell: (variant) => variant.title,
      },
      {
        key: "sku",
        header: "SKU",
        className: "text-muted-foreground",
        cell: (variant) => variant.sku || "—",
      },
      ...product.options.map(
        (option): DataTableColumn<ProductVariantDTO> => ({
          key: `option-${option.id}`,
          header: option.title,
          cell: (variant) => {
            const value = variantOptionValue(variant, option);
            return value ? <Badge variant="secondary">{value}</Badge> : "—";
          },
        }),
      ),
      {
        key: "inventory",
        header: "Inventory",
        className: "text-muted-foreground",
        cell: inventoryLabel,
      },
    ],
    [product.options],
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  // Deleting goes through the shared confirmation, like every other delete in
  // the dashboard: a variant takes its prices and stock with it, and the row
  // menu is one slip away from the Edit item directly above.
  const confirmDelete = useCallback(
    (variantId: string, title: string) => {
      setInfoData({
        title: "Delete Variant",
        description: `Are you sure you want to delete "${title}"? Its prices and stock go with it. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "variantIds",
            value: JSON.stringify([variantId]),
          },
        ],
        action: deleteVariantsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: productQueries.all(),
          });
        },
      });
      setInfoOpen(true);
    },
    [queryClient, setInfoData, setInfoOpen],
  );

  // No `variantId` opens the same page in create mode.
  const openVariant = useCallback(
    (variantId?: string) =>
      void navigate({
        to: "/dashboard/$slug/$id/$page",
        params: { slug: "products", id: product.id, page: "variant" },
        search: variantId ? { variantId } : {},
      }),
    [navigate, product.id],
  );

  /**
   * The table's own columns, as sort keys.
   *
   * The axes sit between Title and the dates so the menu reads in the same
   * order as the columns it sorts. Derived from the product because the axes
   * are the product's — a fixed list could only offer Title and the dates,
   * which is every column except the ones a reader actually scans by.
   */
  const sortOptions = useMemo<DataTableSortOption[]>(
    () => [
      { value: "name", label: "Title" },
      ...product.options.map((option) => ({
        value: optionSortKey(option.id),
        label: option.title,
      })),
      { value: "createdAt", label: "Created" },
      { value: "updatedAt", label: "Updated" },
    ],
    [product.options],
  );

  // The shared sort control writes `?sortBy`/`?sortOrder`; both can be arrays
  // once a second heading is selected, and only the first applies here.
  const routeSortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const routeSortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;

  const matching = sortVariants(
    filterVariants(product.variants, search.q, product.options),
    toVariantSortKey(routeSortBy, product.options),
    routeSortOrder === "asc" ? "asc" : "desc",
    product.options,
  );
  const { rows, pagination } = paginateVariants(
    matching,
    search.page ?? 1,
    VARIANT_PAGE_SIZE,
  );

  return (
    <DataTableCard
      label="Variants"
      columns={columns}
      rows={rows}
      getRowId={(variant) => variant.id}
      searchPlaceholder="Search"
      headerActions={
        // Variants are generated with the product; this is how a combination
        // comes back after someone deleted it.
        product.options.length > 0 ? (
          <Button
            variant="form"
            size="xs"
            className="gap-2"
            onClick={() => openVariant()}
          >
            <Plus className="size-4" />
            Create
          </Button>
        ) : undefined
      }
      sortOptions={sortOptions}
      defaultSortBy="createdAt"
      emptyTitle="No variants yet"
      emptyDescription="Saving the product's options creates one for every combination."
      onRowClick={(variant) => openVariant(variant.id)}
      rowActions={(variant) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () => openVariant(variant.id),
        },
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => confirmDelete(variant.id, variant.title),
        },
      ]}
      pagination={pagination}
    />
  );
};
