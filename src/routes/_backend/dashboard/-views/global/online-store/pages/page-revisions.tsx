import { StatusBadge } from "@/components/ui/status-badge";
import type { StorefrontPageRevisionDTO } from "@/lib/storefront/dto/storefront-page.dto";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { restorePageRevisionAction } from "./page-actions";

export default function StorefrontPageRevisions() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false });
  const page = Number(search.page) || 1;
  const queryClient = useQueryClient();
  const query = useQuery(storefrontPageQueries.revisions(id, page));
  const result = query.data;
  const columns = useMemo<DataTableColumn<StorefrontPageRevisionDTO>[]>(
    () => [
      {
        key: "version",
        header: "Version",
        cell: (revision) => `Version ${revision.version}`,
      },
      {
        key: "state",
        header: "State",
        cell: (revision) => (
          <StatusBadge
            variant="plain"
            color={
              revision.isPublished
                ? "green"
                : revision.isDraft
                  ? "amber"
                  : "grey"
            }
          >
            {revision.isPublished
              ? "Published"
              : revision.isDraft
                ? "Current draft"
                : "Previous"}
          </StatusBadge>
        ),
      },
      {
        key: "createdAt",
        header: "Created",
        cell: (revision) => new Date(revision.createdAt).toLocaleString(),
      },
    ],
    [],
  );

  return (
    <DataTableCard
      label="Revision history"
      description="Restoring creates a new draft and never changes the published version directly."
      columns={columns}
      rows={result?.success ? result.data.revisions : []}
      getRowId={(revision) => revision.id}
      isPending={query.isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={() =>
        void queryClient.invalidateQueries({
          queryKey: storefrontPageQueries.revisions(id, page).queryKey,
        })
      }
      emptyTitle="No revisions"
      emptyDescription="Saving this page creates its first revision."
      pagination={result?.success ? result.data.pagination : undefined}
      rowActions={(revision) => [
        {
          label: "Restore as draft",
          disabled: revision.isDraft,
          onSelect: async () => {
            const restored = await restorePageRevisionAction(id, revision.id);
            if (!restored.success) {
              toast.error(restored.message, { position: "top-center" });
              return;
            }
            await queryClient.invalidateQueries({
              queryKey: storefrontPageQueries.all(),
            });
            toast.success(restored.message, { position: "top-center" });
          },
        },
      ]}
    />
  );
}
