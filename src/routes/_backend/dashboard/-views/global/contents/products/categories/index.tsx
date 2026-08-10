import type { ProductCategoryDTO } from "@/lib/product/dto/product-taxonomy.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  useCollectionEditAction,
  useCollectionDetailPreload,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductCategoryListParams,
  productCategoryQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteProductCategoriesAction } from "../product-actions";
import {
  PRODUCT_CATEGORY_COLUMNS,
  PRODUCT_CATEGORY_SORT_OPTIONS,
} from "./config/product-category-table.config";

const Categories = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("categories");
  const queryClient = useQueryClient();
  const params = normalizeProductCategoryListParams(search);
  const { data: result, isPending } = useQuery(
    productCategoryQueries.list(params),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: productCategoryQueries.all(),
    });
  }, [queryClient]);

  const handleDelete = useCallback(
    (category: ProductCategoryDTO) => {
      setInfoData({
        title: "Delete Category",
        // Descendants go too, so the prompt says so rather than letting the
        // count in the success toast be the first the user hears of it.
        description: `Are you sure you want to delete "${category.name}"? Every category nested under it is deleted as well. Products keep their other categories. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "categoryIds",
            value: JSON.stringify([category.id]),
          },
        ],
        action: deleteProductCategoriesAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const editAction = useCollectionEditAction("categories");

  const categoryRows = result?.success ? (result.data?.categories ?? []) : [];

  return (
    <DataTableCard
      label="Categories"
      description="Organise products into a browsable tree for your storefront."
      searchPlaceholder="Search"
      sortOptions={PRODUCT_CATEGORY_SORT_OPTIONS}
      headerActions={<CollectionCreateButton slug="categories" />}
      columns={PRODUCT_CATEGORY_COLUMNS}
      rows={categoryRows}
      getRowId={(category) => category.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No categories yet"
      emptyDescription="Create a category, then nest others under it to build the tree your storefront browses."
      onRowClick={(category) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "categories", id: category.id },
        })
      }
      onRowPreload={(category) => preloadDetail(category.id)}
      rowActions={(category) => [
        ...editAction(category.id),
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleDelete(category),
        },
      ]}
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};

export default Categories;
