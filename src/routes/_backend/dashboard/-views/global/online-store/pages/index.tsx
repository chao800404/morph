import { StatusBadge } from "@/components/ui/status-badge";
import type { StorefrontPageSummaryDTO } from "@/lib/storefront/dto/storefront-page.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  type DataTableColumn,
  useCollectionDetailPreload,
  useCollectionEditAction,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeStorefrontPageListParams,
  storefrontPageQueries,
} from "@queries/storefront-page.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

export default function StorefrontPages() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery(
    storefrontPageQueries.list(normalizeStorefrontPageListParams(search)),
  );
  const preloadDetail = useCollectionDetailPreload("pages");
  const editActions = useCollectionEditAction("pages");
  const columns = useMemo<DataTableColumn<StorefrontPageSummaryDTO>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        className: "font-medium",
        cell: (row) => row.title,
      },
      { key: "url", header: "URL", cell: (row) => `/${row.handle}` },
      {
        key: "status",
        header: "Status",
        cell: (row) => (
          <StatusBadge
            variant="plain"
            color={
              row.status === "published"
                ? "green"
                : row.status === "archived"
                  ? "grey"
                  : "amber"
            }
          >
            {row.status[0].toUpperCase() + row.status.slice(1)}
          </StatusBadge>
        ),
      },
      {
        key: "updatedAt",
        header: "Updated",
        cell: (row) => new Date(row.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const result = query.data;
  const rows = result?.success ? result.data.pages : [];
  const invalidate = useCallback(
    () =>
      void client.invalidateQueries({ queryKey: storefrontPageQueries.all() }),
    [client],
  );

  return (
    <DataTableCard
      label="Pages"
      description="Create customer-facing pages without duplicating commerce data."
      headerActions={<CollectionCreateButton slug="pages" />}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={query.isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No pages yet"
      emptyDescription="Create the first versioned page for your online store."
      searchPlaceholder="Search pages"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "pages", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      rowActions={(row) => editActions(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
