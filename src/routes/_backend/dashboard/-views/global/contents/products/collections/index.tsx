import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
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
  collectionQueries,
  normalizeCollectionListParams,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createCollectionAction,
  deleteCollectionsAction,
  updateCollectionAction,
} from "../product-actions";

const Collections = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const params = normalizeCollectionListParams(search);
  const { data: result, isPending } = useQuery(collectionQueries.list(params));

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
    void queryClient.invalidateQueries({ queryKey: collectionQueries.all() });
  }, [queryClient]);

  const handleCreate = useCallback(() => {
    setCreateData({
      title: "Create Collection",
      description: "Group related products together",
      fields: [
        {
          type: "input",
          name: "title",
          label: "Title",
          placeholder: "e.g. Summer Release",
          required: true,
          autoFocus: true,
          colSpan: 1,
        },
        {
          type: "input",
          name: "handle",
          label: "Handle",
          placeholder: "Leave blank to derive from the title",
          colSpan: 1,
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          placeholder: "Short collection description...",
          rows: 3,
        },
      ],
      action: createCollectionAction,
      onSuccess: invalidate,
    });
    setCreateOpen(true);
  }, [invalidate, setCreateData, setCreateOpen]);

  const handleEdit = useCallback(
    (collection: ProductCollectionDTO) => {
      setEditOpen(true);
      setEditData({
        title: "Edit Collection",
        description: collection.title,
        fields: [
          { type: "hidden", name: "id", value: collection.id },
          {
            type: "input",
            name: "title",
            label: "Title",
            value: collection.title,
            required: true,
          },
          {
            type: "input",
            name: "handle",
            label: "Handle",
            value: collection.handle,
          },
          {
            type: "textarea",
            name: "description",
            label: "Description",
            value: collection.description ?? "",
          },
        ],
        action: (formData: FormData) =>
          updateCollectionAction({ data: formData }),
        onSuccess: invalidate,
      });
    },
    [invalidate, setEditData, setEditOpen],
  );

  const handleDelete = useCallback(
    (collection: ProductCollectionDTO) => {
      setInfoData({
        title: "Delete Collection",
        description: `Are you sure you want to delete "${collection.title}"? Products stay in the catalogue but lose this collection. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "collectionIds",
            value: JSON.stringify([collection.id]),
          },
        ],
        action: deleteCollectionsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const columns = useMemo<DataTableColumn<ProductCollectionDTO>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        className: "w-64 font-medium",
        cell: (collection) => collection.title,
      },
      {
        key: "handle",
        header: "Handle",
        className: "text-muted-foreground",
        cell: (collection) => collection.handle,
      },
      {
        key: "updatedAt",
        header: "Updated",
        className: "w-40 text-muted-foreground",
        cell: (collection) =>
          new Date(collection.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const collections = result?.success ? (result.data?.collections ?? []) : [];

  return (
    <DataTableCard
      label="Collections"
      description="Organize your products into collections."
      searchPlaceholder="Search"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={
        <CollectionCreateButton slug="collections"
          onCreate={handleCreate} />
      }
      columns={columns}
      rows={collections}
      getRowId={(collection) => collection.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No collections yet"
      emptyDescription="Create collections to group related products together."
      rowActions={(collection) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () => handleEdit(collection),
        },
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleDelete(collection),
        },
      ]}
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};

export default Collections;
