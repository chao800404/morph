import type { ProductOptionDTO } from "@/lib/product/dto/product-option.dto";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionEditAction,
  useCollectionDetailPreload,
  deleteActionIcon,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductOptionListParams,
  productOptionQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteProductOptionsAction } from "../product-actions";
import {
  PRODUCT_OPTION_COLUMNS,
  PRODUCT_OPTION_SORT_OPTIONS,
} from "./config/product-option-table.config";
import { useProductOptionTableControls } from "./hooks/use-product-option-table-controls";

const Options = () => {
  const { search, filters } = useProductOptionTableControls();
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("product-options");
  const queryClient = useQueryClient();
  const params = normalizeProductOptionListParams(search);
  const { data: result, isPending } = useQuery(
    productOptionQueries.list(params),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: productOptionQueries.all(),
    });
  }, [queryClient]);

  const handleDelete = useCallback(
    (option: ProductOptionDTO) => {
      setInfoData({
        title: "Delete Option",
        description: `Are you sure you want to delete "${option.title}"? Products already built with it keep their own values. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "optionIds",
            value: JSON.stringify([option.id]),
          },
        ],
        action: deleteProductOptionsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const editAction = useCollectionEditAction("product-options");

  const optionRows = result?.success ? (result.data?.options ?? []) : [];

  return (
    <DataTableCard
      label="Options"
      description="Manage product options and their associated values."
      filters={filters}
      searchPlaceholder="Search"
      sortOptions={PRODUCT_OPTION_SORT_OPTIONS}
      headerActions={<CollectionCreateButton slug="product-options" />}
      columns={PRODUCT_OPTION_COLUMNS}
      rows={optionRows}
      getRowId={(option) => option.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No product options yet"
      emptyDescription="Create options such as Size, Colour or Material, then pick them when you build a product."
      onRowClick={(option) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "product-options", id: option.id },
        })
      }
      onRowPreload={(option) => preloadDetail(option.id)}
      rowActions={(option) => [
        ...editAction(option.id),
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleDelete(option),
        },
      ]}
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};

export default Options;
