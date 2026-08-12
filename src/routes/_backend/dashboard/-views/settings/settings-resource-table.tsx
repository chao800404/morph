import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { getConfig } from "@/server/get-config";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
  type RowAction,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

export function SettingsResourceTable<T extends { id: string }>({
  slug,
  label,
  description,
  rows,
  columns,
  isPending,
  errorMessage,
  pagination,
  invalidate,
  deleteAction,
  deleteName,
}: {
  slug: string;
  label: string;
  description: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  isPending: boolean;
  errorMessage?: string | null;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  invalidate: () => void;
  deleteAction: (args: { data: FormData }) => Promise<{
    success: boolean;
    message: string;
    errors?: Record<string, string[]>;
  }>;
  deleteName: (row: T) => string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, slug)?.edit?.view,
    [slug],
  );
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((s) => ({ setInfoData: s.setInfoData, setInfoOpen: s.setOpen })),
  );
  const preloadEdit = useCallback(
    (id: string) => {
      void viewPreloader(editView)?.();
      void router.preloadRoute({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug, id },
      });
    },
    [editView, router, slug],
  );
  const remove = useCallback(
    (row: T) => {
      setInfoData({
        title: `Delete ${label.replace(/s$/, "")}`,
        description: `Are you sure you want to delete “${deleteName(row)}”? This action cannot be undone.`,
        fields: [
          { type: "hidden", name: "ids", value: JSON.stringify([row.id]) },
        ],
        action: deleteAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [deleteAction, deleteName, invalidate, label, setInfoData, setInfoOpen],
  );
  return (
    <DataTableCard
      label={label}
      description={description}
      searchPlaceholder="Search"
      sortOptions={[
        { value: "name", label: "Name" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={<CollectionCreateButton slug={slug} scope="settings" />}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={errorMessage}
      onRetry={invalidate}
      emptyTitle={`No ${label.toLowerCase()} yet`}
      emptyDescription={`Create your first ${label.replace(/s$/, "").toLowerCase()}.`}
      rowActions={(row) => {
        const actions: RowAction[] = [];
        if (editView) {
          actions.push({
            label: "Edit",
            icon: editActionIcon,
            onSelect: () =>
              void navigate({
                to: "/dashboard/settings/$slug/$id/edit",
                params: { slug, id: row.id },
              }),
            preload: () => preloadEdit(row.id),
          });
        }
        actions.push({
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => remove(row),
        });
        return actions;
      }}
      pagination={pagination}
    />
  );
}
