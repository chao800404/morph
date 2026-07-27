import { Badge } from "@/components/ui/badge";
import type { ProductOptionDTO } from "@/lib/product/dto/product-option.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { useEditStore } from "@/routes/_backend/dashboard/-views/features/global-edit/use-edit-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductOptionListParams,
  productOptionQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createProductOptionAction,
  deleteProductOptionsAction,
  updateProductOptionAction,
} from "../product-actions";

const Options = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const params = normalizeProductOptionListParams(search);
  const { data: result, isPending } = useQuery(
    productOptionQueries.list(params),
  );

  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const { setEditData, setOpen: setEditOpen } = useEditStore(
    useShallow((state) => ({
      setEditData: state.setEditData,
      setOpen: state.setOpen,
    })),
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

  const handleCreate = useCallback(() => {
    setCreateData({
      title: "Create Product Option",
      description: "Define a reusable option such as Size or Colour.",
      fields: [
        {
          type: "input",
          name: "title",
          label: "Title",
          placeholder: "e.g. Size, Colour, Material",
          required: true,
          autoFocus: true,
        },
        {
          type: "option-values",
          name: "values",
          label: "Values",
          placeholder: "Type a value and press Enter...",
        },
      ],
      action: createProductOptionAction,
      onSuccess: invalidate,
    });
    setCreateOpen(true);
  }, [invalidate, setCreateData, setCreateOpen]);

  const handleEdit = useCallback(
    (option: ProductOptionDTO) => {
      setEditOpen(true);
      setEditData({
        title: "Edit Product Option",
        description: option.title,
        fields: [
          { type: "hidden", name: "id", value: option.id },
          {
            type: "input",
            name: "title",
            label: "Title",
            value: option.title,
            required: true,
          },
          {
            type: "option-values",
            name: "values",
            label: "Values",
            value: option.values.map((value) => value.value),
            placeholder: "Type a value and press Enter...",
          },
        ],
        action: (formData: FormData) =>
          updateProductOptionAction({ data: formData }),
        onSuccess: invalidate,
      });
    },
    [invalidate, setEditData, setEditOpen],
  );

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

  const columns = useMemo<DataTableColumn<ProductOptionDTO>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        className: "w-64 font-medium",
        cell: (option) => option.title,
      },
      {
        key: "values",
        header: "Values",
        cell: (option) =>
          `${option.values.length} value${option.values.length === 1 ? "" : "s"}`,
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        // Every option defined here is reusable across products. A per-product
        // option would be authored on the product itself, not in this list.
        cell: () => <Badge variant="default">Global</Badge>,
      },
    ],
    [],
  );

  const optionRows = result?.success ? (result.data?.options ?? []) : [];

  return (
    <DataTableCard
      label="Options"
      description="Manage product options and their associated values."
      searchPlaceholder="Search"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={
        <CollectionCreateButton slug="options"
          onCreate={handleCreate} />
      }
      columns={columns}
      rows={optionRows}
      getRowId={(option) => option.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No product options yet"
      emptyDescription="Create options such as Size, Colour or Material, then pick them when you build a product."
      rowActions={(option) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () => handleEdit(option),
        },
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
