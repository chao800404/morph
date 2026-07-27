import { Badge } from "@/components/ui/badge";
import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductListParams,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteProductsAction } from "./product-actions";

const STATUS_VARIANT = {
  published: "default",
  draft: "secondary",
  archived: "outline",
} as const;

const Products = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = normalizeProductListParams(search);
  const { data: result, isPending } = useQuery(productQueries.list(params));

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
    (product: ProductDTO) => {
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

  const columns = useMemo<DataTableColumn<ProductDTO>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        className: "w-64 font-medium",
        cell: (product) => product.title,
      },
      {
        key: "handle",
        header: "Handle",
        className: "text-muted-foreground",
        cell: (product) => product.handle,
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        cell: (product) => (
          <Badge variant={STATUS_VARIANT[product.status]}>
            {product.status}
          </Badge>
        ),
      },
      {
        key: "updatedAt",
        header: "Updated",
        className: "w-40 text-muted-foreground",
        cell: (product) => new Date(product.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const products = result?.success ? (result.data?.products ?? []) : [];

  return (
    <DataTableCard
      label="Products"
      description="Manage your products and catalogue."
      searchPlaceholder="Search"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={
        <CollectionCreateButton slug="products" />
      }
      columns={columns}
      rows={products}
      getRowId={(product) => product.id}
      isPending={isPending}
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
      rowActions={(product) => [
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
