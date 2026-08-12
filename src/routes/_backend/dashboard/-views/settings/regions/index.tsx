import type { RegionSummaryDTO } from "@/lib/region/dto/region.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  normalizeRegionListParams,
  regionQueries,
} from "@queries/region.queries";
import { deleteRegionsAction } from "../commerce-actions";
import { SettingsResourceTable } from "../settings-resource-table";

export default function Regions() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    regionQueries.list(normalizeRegionListParams(search)),
  );
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: regionQueries.all() });
  }, [client]);
  const columns = useMemo<DataTableColumn<RegionSummaryDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "font-medium",
        cell: (r) => r.name,
      },
      {
        key: "currency",
        header: "Currency",
        cell: (r) => r.currencyCode.toUpperCase(),
      },
      { key: "countries", header: "Countries", cell: (r) => r.countryCount },
      {
        key: "taxes",
        header: "Automatic taxes",
        cell: (r) => (r.automaticTaxes ? "Enabled" : "Disabled"),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.regions : [];
  return (
    <SettingsResourceTable
      slug="regions"
      label="Regions"
      description="Define currencies, countries, and tax behavior for each market."
      rows={rows}
      columns={columns}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      pagination={result?.success ? result.data.pagination : undefined}
      invalidate={invalidate}
      deleteName={(r) => r.name}
      deleteAction={deleteRegionsAction}
    />
  );
}
