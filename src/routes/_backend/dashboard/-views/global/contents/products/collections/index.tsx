import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { useEditStore } from "@/routes/_backend/dashboard/-views/features/global-edit/use-edit-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  collectionQueries,
  normalizeCollectionListParams,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
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

  const collections = result?.success ? (result.data?.collections ?? []) : [];
  // Loading, error and empty states are centred in the card; the table is not.
  const showsPlaceholder =
    isPending || (result && !result.success) || collections.length === 0;
  const createButton = (
    <Button onClick={handleCreate} variant="form" size="sm" className="gap-2">
      <Plus className="size-4" />
      Create
    </Button>
  );

  return (
    <CardWrapper
      label="Collections"
      description="Organize your products into collections"
      headerButton={createButton}
      classNames={{
        cardWrapper: "min-h-content",
        contentWrapper: showsPlaceholder
          ? "flex flex-col items-center justify-center"
          : undefined,
      }}
    >
      {isPending ? (
        <Spinner />
      ) : result && !result.success ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-destructive">{result.message}</p>
          <Button variant="outline" size="sm" onClick={invalidate}>
            Retry
          </Button>
        </div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center gap-3 opacity-70">
            <EmptyFileIcon />
            <h3 className="mt-2 text-lg font-medium text-foreground">
              No collections yet
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create collections to group related products together.
            </p>
            <div className="mt-4">{createButton}</div>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Handle</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collections.map((collection) => (
              <TableRow key={collection.id}>
                <TableCell className="font-medium">
                  {collection.title}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {collection.handle}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(collection.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${collection.title}`}
                    onClick={() => handleEdit(collection)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${collection.title}`}
                    onClick={() => handleDelete(collection)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardWrapper>
  );
};

export default Collections;
