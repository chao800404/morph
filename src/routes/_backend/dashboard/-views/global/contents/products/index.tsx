import type { ProductListItemDTO } from "@/lib/product/dto/product.dto";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  useCollectionEditAction,
  useCollectionDetailPreload,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductListParams,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteProductsAction } from "./product-actions";
import { PRODUCT_SORT_OPTIONS } from "./config/product-table.config";
import { PRODUCT_TABLE_COLUMNS } from "./config/product-table-columns";
import { useProductTableControls } from "./hooks/use-product-table-controls";
import { tableViewQueries } from "@queries/table-view.queries";
import { ProductIndexSkeleton } from "./product-index-skeleton";

const Products = () => {
  const { search, filters } = useProductTableControls();
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("products");
  const editAction = useCollectionEditAction("products");
  const queryClient = useQueryClient();
  const params = normalizeProductListParams(search);
  const { data: result, isPending } = useQuery(productQueries.list(params));
  const { data: tableViewResult } = useSuspenseQuery(
    tableViewQueries.detail("products"),
  );
  const initialColumnConfiguration =
    tableViewResult.success && tableViewResult.data
      ? {
          order: tableViewResult.data.columnOrder,
          hidden: tableViewResult.data.hiddenColumns,
        }
      : null;

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  // Product creation is a multi-step flow with a variant matrix, which the
  // shared `fields` dialog cannot express, so it lives on its own route.

  const handleDelete = useCallback(
    (product: ProductListItemDTO) => {
      setInfoData({
        title: "Delete Product",
        description: `Are you sure you want to delete "${product.title}"? Its variants and prices go with it. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "productIds",
            value: JSON.stringify([product.id]),
          },
        ],
        action: deleteProductsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const products = result?.success ? (result.data?.products ?? []) : [];
  if (isPending) return <ProductIndexSkeleton />;

  return (
    <DataTableCard
      label="Products"
      description="Manage your products and catalogue."
      searchPlaceholder="Search"
      columnConfigurationKey="products"
      initialColumnConfiguration={initialColumnConfiguration}
      filters={filters}
      sortOptions={PRODUCT_SORT_OPTIONS}
      headerActions={<CollectionCreateButton slug="products" />}
      columns={PRODUCT_TABLE_COLUMNS}
      rows={products}
      getRowId={(product) => product.id}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No products yet"
      emptyDescription="Get started by creating your first product to display in your store."
      onRowClick={(product) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "products", id: product.id },
        })
      }
      onRowPreload={(product) => preloadDetail(product.id)}
      rowActions={(product) => [
        ...editAction(product.id),
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleDelete(product),
        },
      ]}
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};

export default Products;
