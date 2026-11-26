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
import { PAGE_DRAFT_CONFLICT } from "@/lib/storefront/page-write-errors";
import { restorePageRevisionAction } from "./page-actions";

export default function StorefrontPageRevisions() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false });
  const page = Number(search.page) || 1;
  const queryClient = useQueryClient();
  const query = useQuery(storefrontPageQueries.revisions(id, page));
  const detail = useQuery(storefrontPageQueries.detail(id));
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
            // Restoring replaces the draft, so it names the draft it was
            // chosen against: the Page detail's version, not the list's,
            // which may not hold the current draft on this page of it.
            const draft = detail.data?.success ? detail.data.data : null;
            if (!draft) {
              toast.error("The page is still loading. Try again.", {
                position: "top-center",
              });
              return;
            }
            const restored = await restorePageRevisionAction(
              id,
              revision.id,
              draft.version,
            );
            if (!restored.success) {
              // Changed elsewhere: the latest Page and history are loaded;
              // nothing is restored until the author chooses again.
              if (
                (restored as { error?: string }).error === PAGE_DRAFT_CONFLICT
              ) {
                await queryClient.invalidateQueries({
                  queryKey: storefrontPageQueries.all(),
                });
              }
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
