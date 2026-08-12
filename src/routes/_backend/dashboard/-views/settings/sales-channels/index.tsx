import type { SalesChannelSummaryDTO } from "@/lib/sales-channel/dto/sales-channel.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";
import { deleteSalesChannelsAction } from "../commerce-actions";
import { SettingsResourceTable } from "../settings-resource-table";

export default function SalesChannels() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    salesChannelQueries.list(normalizeSalesChannelListParams(search)),
  );
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: salesChannelQueries.all() });
  }, [client]);
  const columns = useMemo<DataTableColumn<SalesChannelSummaryDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "font-medium",
        cell: (r) => r.name,
      },
      {
        key: "status",
        header: "Status",
        cell: (r) => (r.isDisabled ? "Disabled" : "Active"),
      },
      { key: "products", header: "Products", cell: (r) => r.productCount },
      {
        key: "updated",
        header: "Updated",
        cell: (r) => new Date(r.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.salesChannels : [];
  return (
    <SettingsResourceTable
      slug="sales-channels"
      label="Sales Channels"
      description="Control where products are available."
      rows={rows}
      columns={columns}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      pagination={result?.success ? result.data.pagination : undefined}
      invalidate={invalidate}
      deleteName={(r) => r.name}
      deleteAction={deleteSalesChannelsAction}
    />
  );
}
