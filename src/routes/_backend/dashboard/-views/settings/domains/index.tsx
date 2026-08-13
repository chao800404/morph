import { StatusBadge } from "@/components/ui/status-badge";
import type { StorefrontDomainDTO } from "@/lib/storefront/dto/storefront-domain.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { setPrimaryStorefrontDomain } from "@/server/storefront/storefront-domains.serverFn";
import {
  normalizeStorefrontDomainListParams,
  storefrontDomainQueries,
} from "@queries/storefront-domain.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { deleteDomainsAction } from "./domain-actions";

export default function Domains() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    storefrontDomainQueries.list(normalizeStorefrontDomainListParams(search)),
  );
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setInfoOpen: state.setOpen,
    })),
  );
  const invalidate = useCallback(
    () =>
      void client.invalidateQueries({
        queryKey: storefrontDomainQueries.all(),
      }),
    [client],
  );
  const columns = useMemo<DataTableColumn<StorefrontDomainDTO>[]>(
    () => [
      {
        key: "hostname",
        header: "Domain",
        className: "font-medium",
        cell: (row) => row.hostname,
      },
      {
        key: "type",
        header: "Type",
        cell: (row) =>
          row.isPrimary ? (
            <StatusBadge variant="plain" color="blue">
              Primary
            </StatusBadge>
          ) : (
            "Redirect"
          ),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => (
          <StatusBadge
            variant="plain"
            color={
              row.status === "active"
                ? "green"
                : row.status === "failed"
                  ? "red"
                  : "amber"
            }
          >
            {row.status === "active"
              ? "Connected"
              : row.status === "failed"
                ? "Failed"
                : "Pending"}
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
  const rows = result?.success ? result.data.domains : [];
  const remove = useCallback(
    (row: StorefrontDomainDTO) => {
      setInfoData({
        title: "Remove domain",
        description: `Remove “${row.hostname}” from this storefront and Cloudflare?`,
        fields: [
          { type: "hidden", name: "ids", value: JSON.stringify([row.id]) },
        ],
        action: deleteDomainsAction,
        confirmLabel: "Remove",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );
  return (
    <DataTableCard
      label="Domains"
      description="Connect and manage the domains customers use to visit your online store."
      headerActions={<CollectionCreateButton slug="domains" scope="settings" />}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No domains yet"
      emptyDescription="Connect a domain to publish your online store at your own address."
      searchPlaceholder="Search domains"
      sortOptions={[
        { value: "name", label: "Domain" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      rowActions={(row) => [
        {
          label: "Make primary",
          icon: <CheckCircle2 className="size-4" />,
          disabled: row.isPrimary || row.status !== "active",
          onSelect: async () => {
            const value = await setPrimaryStorefrontDomain({
              data: { id: row.id },
            });
            value.success
              ? toast.success(value.message)
              : toast.error(value.message);
            if (value.success) invalidate();
          },
        },
        {
          label: "Remove",
          icon: deleteActionIcon,
          destructive: true,
          disabled: row.isPrimary,
          onSelect: () => remove(row),
        },
      ]}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
