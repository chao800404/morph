import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionEditAction,
  deleteActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
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
  deleteCollectionsAction,
} from "../product-actions";

const Collections = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const params = normalizeCollectionListParams(search);
  const { data: result, isPending } = useQuery(collectionQueries.list(params));



  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: collectionQueries.all() });
  }, [queryClient]);



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

  const editAction = useCollectionEditAction("collections");

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
        <CollectionCreateButton slug="collections" />
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
        ...editAction(collection.id),
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
