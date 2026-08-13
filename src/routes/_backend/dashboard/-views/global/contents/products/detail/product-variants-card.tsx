import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageSmBlock } from "@/components/asset/image-block";
import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import { optionSortKey, variantOptionValue } from "@/lib/product/variant-table";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
  type DataTableSortOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { getConfig } from "@/server/get-config";
import {
  normalizeProductVariantListParams,
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  ImageIcon,
  MoreHorizontal,
  Plus,
  Warehouse,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Search, option-axis sorting, and pagination are applied by the DAL before
 * hydration so a large catalogue never travels through the product detail
 * response merely to draw one table page.
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const variantDetailView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "products")?.pages
        ?.variant?.view,
    [],
  );
  const variantParams = normalizeProductVariantListParams(product.id, search);
  const variantQuery = useQuery(productVariantQueries.list(variantParams));
  const variantResult = variantQuery.data?.success
    ? variantQuery.data.data
    : null;

  const columns = useMemo<DataTableColumn<ProductVariantDTO>[]>(
    () => [
      {
        key: "thumbnail",
        header: "",
        className: "w-10 text-muted-foreground",
        cell: (variant) => {
          const thumbnail = variant.assets[0];
          return (
            <span className="flex w-6 items-center justify-center">
              {thumbnail ? (
                <ImageSmBlock src={thumbnail.url} alt={thumbnail.name} />
              ) : (
                <ImageIcon className="size-4" aria-hidden />
              )}
            </span>
          );
        },
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
          void queryClient.invalidateQueries({
            queryKey: productVariantQueries.all(),
          });
        },
      });
      setInfoOpen(true);
    },
    [queryClient, setInfoData, setInfoOpen],
  );

  const openVariantDetail = useCallback(
    (variantId: string) =>
      void navigate({
        to: "/dashboard/$slug/$id/$page/$childId",
        params: {
          slug: "products",
          id: product.id,
          page: "variant",
          childId: variantId,
        },
      }),
    [navigate, product.id],
  );

  const preloadVariantDetail = useCallback(
    (variantId: string) => {
      void viewPreloader(variantDetailView)?.();
      void router.preloadRoute({
        to: "/dashboard/$slug/$id/$page/$childId",
        params: {
          slug: "products",
          id: product.id,
          page: "variant",
          childId: variantId,
        },
      });
    },
    [product.id, router, variantDetailView],
  );

  // No `variantId` opens the editor in create mode.
  const openVariantEditor = useCallback(
    (variantId?: string) =>
      void navigate({
        to: "/dashboard/$slug/$id/$page",
        params: { slug: "products", id: product.id, page: "variant-edit" },
        search: variantId ? { variantId } : {},
      }),
    [navigate, product.id],
  );
  const openBulkEditor = useCallback(
    (page: "variant-prices" | "variant-inventory") =>
      void navigate({
        to: "/dashboard/$slug/$id/$page",
        params: { slug: "products", id: product.id, page },
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

  return (
    <DataTableCard
      label="Variants"
      columns={columns}
      rows={variantResult?.variants ?? []}
      getRowId={(variant) => variant.id}
      searchPlaceholder="Search"
      headerActions={
        // Variants are generated with the product; this is how a combination
        // comes back after someone deleted it.
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="cardHeader"
                size="xs"
                aria-label="Variant actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => openBulkEditor("variant-prices")}
              >
                <BadgeDollarSign className="size-4" />
                Edit prices
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openBulkEditor("variant-inventory")}
              >
                <Warehouse className="size-4" />
                Edit inventory
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {product.options.length > 0 ? (
            <Button
              variant="form"
              size="xs"
              className="gap-2"
              onClick={() => openVariantEditor()}
            >
              <Plus className="size-4" />
              Create
            </Button>
          ) : null}
        </div>
      }
      sortOptions={sortOptions}
      defaultSortBy="createdAt"
      isPending={variantQuery.isPending}
      errorMessage={
        variantQuery.isError
          ? "Failed to load variants"
          : variantQuery.data && !variantQuery.data.success
            ? variantQuery.data.message
            : undefined
      }
      onRetry={() => void variantQuery.refetch()}
      emptyTitle="No variants yet"
      emptyDescription="Saving the product's options creates one for every combination."
      onRowClick={(variant) => openVariantDetail(variant.id)}
      onRowPreload={(variant) => preloadVariantDetail(variant.id)}
      rowActions={(variant) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () => openVariantEditor(variant.id),
        },
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => confirmDelete(variant.id, variant.title),
        },
      ]}
      pagination={variantResult?.pagination}
    />
  );
};
