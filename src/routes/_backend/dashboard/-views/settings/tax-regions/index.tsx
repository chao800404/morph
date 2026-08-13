import type { TaxRegionSummaryDTO } from "@/lib/tax/dto/tax.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CountryFlag } from "@/components/ui/phone-input";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { normalizeTaxRegionListParams, taxQueries } from "@queries/tax.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { SettingsResourceTable } from "../settings-resource-table";
import { deleteTaxRegionsAction } from "./tax-actions";

export default function TaxRegions() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const query = useQuery(taxQueries.list(normalizeTaxRegionListParams(search)));
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: taxQueries.all() });
  }, [client]);
  const columns = useMemo<DataTableColumn<TaxRegionSummaryDTO>[]>(
    () => [
      {
        key: "country",
        header: "Country",
        className: "font-medium",
        cell: (region) => (
          <span className="flex min-w-0 items-center gap-2">
            <CountryFlag
              country={region.countryCode.toUpperCase()}
              countryName={region.countryName}
              className="h-3.5 w-5"
            />
            <span className="truncate">{region.countryName}</span>
          </span>
        ),
      },
      {
        key: "code",
        header: "Code",
        cell: (region) => region.countryCode.toUpperCase(),
      },
      {
        key: "provinces",
        header: "Sub-regions",
        cell: (region) => region.provinceCount,
      },
      {
        key: "rates",
        header: "Tax rates",
        cell: (region) => region.taxRateCount,
      },
      {
        key: "provider",
        header: "Provider",
        cell: (region) => region.providerId?.replace(/^tp_/, "") ?? "—",
      },
    ],
    [],
  );
  const rows = query.data?.success ? query.data.data.taxRegions : [];
  return (
    <SettingsResourceTable
      slug="tax-regions"
      label="Tax Regions"
      description="Manage tax regions and rates for the countries where you sell."
      rows={rows}
      columns={columns}
      isPending={query.isPending}
      errorMessage={
        query.data && !query.data.success ? query.data.message : null
      }
      pagination={query.data?.success ? query.data.data.pagination : undefined}
      invalidate={invalidate}
      deleteAction={deleteTaxRegionsAction}
      deleteName={(region) => region.countryName}
    />
  );
}
