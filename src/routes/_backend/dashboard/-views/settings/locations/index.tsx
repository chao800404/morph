import type { StockLocationDTO } from "@/lib/stock-location/dto/stock-location.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CountryFlag } from "@/components/ui/phone-input";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  normalizeStockLocationListParams,
  stockLocationQueries,
} from "@queries/stock-location.queries";
import { deleteLocationsAction } from "../commerce-actions";
import { SettingsResourceTable } from "../settings-resource-table";
export default function Locations() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    stockLocationQueries.list(normalizeStockLocationListParams(search)),
  );
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: stockLocationQueries.all() });
  }, [client]);
  const columns = useMemo<DataTableColumn<StockLocationDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "font-medium",
        cell: (r) => r.name,
      },
      {
        key: "address",
        header: "Address",
        cell: (r) => {
          if (!r.address) return "—";
          const address = [r.address.address1, r.address.city]
            .filter(Boolean)
            .join(", ");
          return (
            <span className="flex min-w-0 items-center gap-2">
              {r.address.countryCode ? (
                <CountryFlag
                  country={r.address.countryCode.toUpperCase()}
                  countryName={r.address.countryCode.toUpperCase()}
                  className="h-3.5 w-5"
                />
              ) : null}
              <span className="truncate">
                {[address, r.address.countryCode?.toUpperCase()]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
          );
        },
      },
      {
        key: "updated",
        header: "Updated",
        cell: (r) => new Date(r.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.locations : [];
  return (
    <SettingsResourceTable
      slug="locations"
      label="Locations"
      description="Manage the physical locations that hold and ship inventory."
      rows={rows}
      columns={columns}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      pagination={result?.success ? result.data.pagination : undefined}
      invalidate={invalidate}
      deleteName={(r) => r.name}
      deleteAction={deleteLocationsAction}
    />
  );
}
