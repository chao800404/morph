import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type { ProductStatus } from "@/db/product.schema";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  useCollectionEditAction,
  useCollectionDetailPreload,
  type DataTableColumn,
  type DataTableFilterDefinition,
  type DataTableFilterOption,
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
import { ProductStatusBadge } from "./components/product-status-badge";

const PRODUCT_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] satisfies DataTableFilterOption<ProductStatus>[];

const PRODUCT_DATE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] satisfies DataTableFilterOption<
  NonNullable<DashboardSearch["productCreatedWithin"]>
>[];

const Products = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("products");
  const editAction = useCollectionEditAction("products");
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
          <ProductStatusBadge status={product.status} variant="plain" />
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
  const setFilter = <
    TKey extends
      | "productStatus"
      | "productCreatedWithin"
      | "productUpdatedWithin",
  >(
    key: TKey,
    value: DashboardSearch[TKey],
  ) => {
    void navigate({
      to: ".",
      search: (previous: DashboardSearch) => ({
        ...previous,
        [key]: value,
        page: undefined,
      }),
      replace: true,
    });
  };
  const filters: DataTableFilterDefinition[] = [
    {
      key: "status",
      label: "Status",
      options: [...PRODUCT_STATUS_OPTIONS],
      values: search.productStatus ? [search.productStatus] : [],
      multiple: false,
      onValuesChange: (values) =>
        setFilter(
          "productStatus",
          values.at(-1) as DashboardSearch["productStatus"],
        ),
    },
    {
      key: "created",
      label: "Created",
      options: [...PRODUCT_DATE_OPTIONS],
      values: search.productCreatedWithin ? [search.productCreatedWithin] : [],
      multiple: false,
      onValuesChange: (values) =>
        setFilter(
          "productCreatedWithin",
          values.at(-1) as DashboardSearch["productCreatedWithin"],
        ),
    },
    {
      key: "updated",
      label: "Updated",
      options: [...PRODUCT_DATE_OPTIONS],
      values: search.productUpdatedWithin ? [search.productUpdatedWithin] : [],
      multiple: false,
      onValuesChange: (values) =>
        setFilter(
          "productUpdatedWithin",
          values.at(-1) as DashboardSearch["productUpdatedWithin"],
        ),
    },
  ];

  return (
    <DataTableCard
      label="Products"
      description="Manage your products and catalogue."
      searchPlaceholder="Search"
      filters={filters}
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={<CollectionCreateButton slug="products" />}
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
